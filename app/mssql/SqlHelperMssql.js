/*
   Copyright 2016 Daniel Kottow

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

var _ = require('underscore');
var util = require('util');
var crypto = require('crypto'); //md5

var log = require('../log.js').log;

var SqlHelperMssql = {
	Field: {},
	Table: {},
	Schema: {}
}

var mssql = require('mssql');

SqlHelperMssql.EncloseSQL = function(name) {
	return '[' + name + ']';
}

SqlHelperMssql.ConcatSQL = function(values) {
	return values.join(' + '); 
}

SqlHelperMssql.OffsetLimitSQL = function(offset, limit) {
	return ' OFFSET ' + offset + ' ROWS' 
		+ ' FETCH NEXT ' + limit + ' ROWS ONLY';
}

SqlHelperMssql.param = function(attrs)
{
	return { 
		name: attrs.name, 
		value: attrs.value, 
		type: attrs.type,
		sql: '@' + attrs.name
	};
}

SqlHelperMssql.addInputParams = function(req, params)
{
	_.each(params, function(param) {
//console.log(param.name, SqlHelperMssql.mssqlType(param.type), param.value);
		req.input(param.name, SqlHelperMssql.mssqlType(param.type), param.value);
	});	
}

SqlHelperMssql.mssqlType = function(fieldType)
{
	var typeName = SqlHelperMssql.typeName(fieldType);

	if (typeName == 'text') return mssql.NVarChar;
	else if (typeName == 'integer') return mssql.Int;
	else if (typeName == 'decimal') return mssql.Float; //TODO - use decimal?
	else if (typeName == 'timestamp') return mssql.VarChar(256); //TODO - use real js dates?
	else if (typeName == 'date') return mssql.VarChar(256); //TODO - use real js dates?
	else if (typeName == 'float') return mssql.Float;
	else throw new Error("unknown type '" + fieldType + "'");
}

SqlHelperMssql.ACCOUNT_DATABASE_SEPARATOR = '$';

/********** Schema stuff *********/

SqlHelperMssql.Schema.createFullTextCatalogSQL = function(name) {
	return 'CREATE FULLTEXT CATALOG ftCatalog AS DEFAULT;\n\n';
}

SqlHelperMssql.Schema.fullName = function(account, db) {
	return account + SqlHelperMssql.ACCOUNT_DATABASE_SEPARATOR + db;
}

SqlHelperMssql.Schema.name = function(fullName) {
	if (_.isString(fullName) && fullName.indexOf(SqlHelperMssql.ACCOUNT_DATABASE_SEPARATOR) > 0) {
		return fullName.substr(fullName.indexOf(SqlHelperMssql.ACCOUNT_DATABASE_SEPARATOR) + 1);
	}
	throw new Error(util.format("Invalid database name '%s'", fullName));
}

SqlHelperMssql.Schema.createPropsTableSQL = function(name) {
	return "CREATE TABLE " + name + " ("
		+ " name VARCHAR(256) NOT NULL, "
		+ "	value VARCHAR(MAX), "
		+ "	PRIMARY KEY (name) "
		+ ");\n\n"
}

SqlHelperMssql.Schema.dropSQL = function(dbName) {
	return util.format("IF EXISTS(select * from sys.databases where name='%s')\n"
			+ 'BEGIN\n'
			+ '  ALTER DATABASE [%s] SET SINGLE_USER WITH ROLLBACK IMMEDIATE\n'
			+ '  DROP DATABASE [%s]\n'
			+ 'END\n\n', dbName, dbName, dbName);
}


/******** Table stuff ********/

SqlHelperMssql.Table.createPropsTableSQL = function(name) {
	return "CREATE TABLE " + name + " ("
		+ " name VARCHAR(256) NOT NULL, "
		+ "	props VARCHAR(MAX), "
		+ " disabled INTEGER DEFAULT 0, "
		+ "	PRIMARY KEY (name) "
		+ ");\n\n";
}

SqlHelperMssql.Table.hasTriggers = function() { return false; }

/*** TODO see here
https://docs.microsoft.com/en-us/sql/t-sql/statements/create-fulltext-index-transact-sql
****/

SqlHelperMssql.Table.createPrimaryKeySQL = function(name) {
	return "CONSTRAINT " + SqlHelperMssql.EncloseSQL(SqlHelperMssql.Table.pkIndexName(name)) + " PRIMARY KEY CLUSTERED (id)";
}

SqlHelperMssql.Table.pkIndexName = function(name) {
	return 'PK__' + name + '__' + 'D365';
}

SqlHelperMssql.Table.createSearchSQL = function(table) {
	var textFields = _.filter(table.fields(), function(f) {
		return f.typeName() == 'text';
	});
	var sql = util.format('CREATE FULLTEXT INDEX ON %s', table.name);
	sql += ' (';
	sql += _.map(textFields, function(f) {
		return SqlHelperMssql.EncloseSQL(f.name);
	}).join(', ');
	sql += ') KEY INDEX ' + SqlHelperMssql.Table.pkIndexName(table.name);
	sql += ' WITH STOPLIST OFF';
	return sql;
}

SqlHelperMssql.Table.dropSearchSQL = function(table) {
	return ''; //no need to drop this explicitly
	//return 'DROP FULLTEXT INDEX ON ' + table.name;
}

SqlHelperMssql.Table.constraintName = function(table, fk) {
	return 'FK__' + crypto.createHash('md5').update(table.name + '.' + fk.name).digest('hex').substr(0, 16) + '__D365';
}

SqlHelperMssql.Table.addForeignKeysSQL = function(table, fk_table) {
	var foreignKeys = _.where(table.foreignKeys(), { fk_table: fk_table.name });
	return _.reduce(foreignKeys, function(sql, fk) {
		return sql + util.format('ALTER TABLE %s ADD CONSTRAINT %s FOREIGN KEY (%s) REFERENCES %s(%s);\n',
							table.name,
							SqlHelperMssql.Table.constraintName(table, fk),
							fk.name,
							fk.fk_table,
							fk.fk_field);			
	}, '');
}

SqlHelperMssql.Table.dropForeignKeysSQL = function(table, fk_table) {
	var foreignKeys = _.where(table.foreignKeys(), { fk_table: fk_table.name });
	return _.reduce(foreignKeys, function(sql, fk) {
		console.log('drop ' + table.name + '.' + fk.name);
		return sql + util.format('ALTER TABLE %s DROP CONSTRAINT %s;\n',
							table.name, 
							SqlHelperMssql.Table.constraintName(table, fk));			
	}, '');
}


/********** Field **********/

SqlHelperMssql.Field.createPropsTableSQL = function(name) {
	return " CREATE TABLE " + name + " ("
		+ ' table_name VARCHAR(256) NOT NULL, '
		+ ' name VARCHAR(256) NOT NULL, '
		+ ' props VARCHAR(MAX), '
		+ ' disabled INTEGER DEFAULT 0, '
		+ ' PRIMARY KEY (name, table_name) '
		+ ");\n\n";
}
		
SqlHelperMssql.Field.defaultSQL = function(field) {

	if (_.contains(['mod_on', 'add_on'], field.name)) {
		return "DEFAULT GETDATE()";

	} else if (_.contains(['mod_by', 'add_by'], field.name)) {
		return "DEFAULT 'sql'";

	} else {
		return '';
	}
}


SqlHelperMssql.Field.typeSQL = function(fieldType)
{
	var typeName = SqlHelperMssql.typeName(fieldType);
	
	if (typeName == 'text') return fieldType == 'text' ? 'NVARCHAR(4000)' : fieldType.replace(/^text/, 'NVARCHAR');
	else if (typeName == 'integer') return 'INTEGER';
	else if (typeName == 'decimal') return fieldType == 'decimal' ? 'DECIMAL(12,2)' : fieldType.replace(/^decimal/, 'DECIMAL');
	else if (typeName == 'timestamp') return 'DATETIME';
	else if (typeName == 'date') return 'DATE'; 
	else if (typeName == 'float') return 'FLOAT'; 
	else throw new Error("SqlHelperMssql unknown type '" + fieldType + "'");
}

SqlHelperMssql.Field.fromSQLType = function(sqlTypeInfo)
{
	if (sqlTypeInfo.data_type == 'nvarchar' || sqlTypeInfo.data_type == 'varchar') {
		return util.format('text(%s)', (sqlTypeInfo.character_maximum_length > 0) ?
										sqlTypeInfo.character_maximum_length : 'MAX');

	} else if (sqlTypeInfo.data_type == 'decimal' || sqlTypeInfo.data_type == 'numeric') {
		return util.format('decimal(%s,%s)', 
						sqlTypeInfo.numeric_precision, sqlTypeInfo.numeric_scale);

	} else if (sqlTypeInfo.data_type == 'int') {
		return 'integer';
	} else if (sqlTypeInfo.data_type == 'datetime') {
		return 'timestamp';
	} else if (sqlTypeInfo.data_type == 'date') {
		return 'date';
	} else if (sqlTypeInfo.data_type == 'float') {
		return 'float';
	} 
	throw new Error("SqlHelperMssql.Field.fromSQLType '" + sqlTypeInfo.data_type + "'");
}

SqlHelperMssql.Field.foreignKeySQL = function(table, fk)
{
	return fk.fk 
		? util.format(' CONSTRAINT %s REFERENCES %s(%s)',
				SqlHelperMssql.Table.constraintName(table, fk),
				fk.fk_table,
				fk.fk_field)
		: '';
}

SqlHelperMssql.Field.autoIncrementSQL = function() 
{
	return 'IDENTITY(1,1)';
}

SqlHelperMssql.dateToStringSQL = function(fieldName)
{
	return util.format('CONVERT(CHAR(10), %s, 126)', fieldName);
}

SqlHelperMssql.timestampToStringSQL = function(fieldName)
{
	// 	yyyy-mm-ddThh:mi:ss.mmm
	return util.format('CONVERT(VARCHAR(30), %s, 126)', fieldName);
}

exports.SqlHelperMssql = SqlHelperMssql;

