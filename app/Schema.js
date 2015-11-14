var  fs = require('fs');
var  path = require('path');
var _ = require('underscore');
var util = require('util');
var assert = require('assert');

var tmp = require('tmp'); //tmp filenames

var sqlite3 = require('sqlite3').verbose();

global.log = global.log || require('bunyan').createLogger({
	name: 'g6.server',
	level: 'debug',
	src: true,
	stream: process.stderr
});

global.tmp_dir = global.tmp_dir || '.';

//console.log('TMP DIR ' + tmp_dir);

var USE_VIEW = true;

var schema = {};

schema.Field = function(fieldDef) {
	//prototype defs call the ctor with no args, get out!
	if (fieldDef == undefined) return;

	var me = this;
	init(fieldDef);

	function init(fieldDef) {
		var errMsg = util.format("Field.init(%s) failed. "
					, util.inspect(fieldDef));
		assert(_.isObject(fieldDef), errMsg);
		assert(_.has(fieldDef, "name"), errMsg + " Name attr missing.");
		assert(_.has(fieldDef, "type"), errMsg + " Type attr missing.");

		me.name = fieldDef.name;

		if ( ! /^\w+$/.test(fieldDef.name)) {
			throw new Error(errMsg 
					+ " Field names can only have word-type characters.");
		}

		me.type = fieldDef.type;
		me.notnull = fieldDef.notnull || 0;

		me.fk = fieldDef.fk_table ? 1 : 0;
		if (me.fk) {
			me.fk_table = fieldDef.fk_table;
			me.fk_field = "id";
		}

		//non-SQL attributes				
		_.each(schema.Field.PROPERTIES, function(f) {
			me[f] = fieldDef[f];
		});

		//notnull
		me.order = me.order || 0;

		//parse possible JSON
		if (_.isString(me.domain)) {
			me.domain = JSON.parse(me.domain);
		}
	}
}

schema.Field.TABLE = '__fieldprops__';
schema.Field.PROPERTIES = ['order', 'domain', 'label']; //no change in db schema
schema.Field.TABLE_FIELDS = ['name', 'table_name']
		.concat(schema.Field.PROPERTIES);

schema.Field.CreateTableSQL 
	= " CREATE TABLE " + schema.Field.TABLE + " ("
		+ ' name VARCHAR NOT NULL, '
		+ ' table_name VARCHAR NOT NULL, '
		+ ' label VARCHAR, '
		+ '"order" INTEGER NOT NULL, '
		+ ' domain VARCHAR, '
		+ ' PRIMARY KEY (name, table_name) '
		+ ");\n\n";


schema.Field.create = function(fieldDef) {
	var errMsg = util.format("schema.Field.create(%s) failed. "
				, util.inspect(fieldDef));

	assert(_.has(fieldDef, "type"), errMsg + " Type attr missing.");

	if (fieldDef.type.indexOf("VARCHAR") == 0) {
		return new schema.TextField(fieldDef);
	} else if (fieldDef.type == "INTEGER") {
		return new schema.IntegerField(fieldDef);
	} else if (fieldDef.type.indexOf("NUMERIC") == 0) {
		return new schema.NumericField(fieldDef);
	} else if (fieldDef.type == "DATETIME" || fieldDef.type == "DATE") {
		return new schema.DatetimeField(fieldDef);
	}

	throw new Error(util.format("schema.Field.create(%s) failed. Unknown type.", util.inspect(fieldDef)));

}



schema.Field.prototype.sqlValue = function(name) {
	switch(name) {
		case 'order': 
			return this.order;
		break;

		case 'domain': 
			return this.domain
				? "'" + JSON.stringify(this.domain) + "'"
				: 'null';
		break;			

		default:
			return this[name]
				? "'" + this[name] + "'"
				: 'null';
	}	
}

schema.Field.prototype.constraintSQL = function() {
	return "";
}

schema.Field.prototype.foreignKeySQL = function() {
	return this.fk 
		? util.format("REFERENCES %s(%s)", this.fk_table, this.fk_field)
		: "";
}

schema.Field.prototype.toSQL = function() {
	var sql = '"' + this.name + '" ' + this.type;
	if (this.notnull) sql += " NOT NULL";
	sql += " " + this.constraintSQL();
	sql += " " + this.foreignKeySQL();
	return sql;
}

schema.Field.prototype.insertPropSQL = function(table) {

	var values = [ this.sqlValue('name'), table.sqlValue('name') ];

	var props = _.map(schema.Field.PROPERTIES, function(f) {
		return this.sqlValue(f);
	}, this);

	var fields = _.map(schema.Field.TABLE_FIELDS, function(f) {
		return '"' + f + '"';
	});

	var sql = 'INSERT INTO ' + schema.Field.TABLE
			+ ' (' + fields.join(',') + ') ' 
			+ ' VALUES (' + values.join(',') + ',' + props.join(',') + '); ';

	return sql;
}

schema.Field.prototype.toJSON = function() {

	var result = {
		name: this.name,
		type: this.type,
		fk: this.fk,
		notnull: this.notnull
	};

	if (result.fk == 1) {
		result.fk_table = this.fk_table;
	}

	_.each(schema.Field.PROPERTIES, function(f) {
		result[f] = this[f];
	}, this);

	return result;
}

schema.Field.REF_NAME = 'ref';

schema.Field.prototype.refName = function() {
	return this.fk_table +'_ref';
}

schema.TextField = function(fieldDef) {
	schema.Field.call(this, fieldDef);
}

schema.TextField.prototype = new schema.Field;	

schema.TextField.prototype.constraintSQL = function() {
	var sql = "CONSTRAINT chk_" + this.name + " CHECK ("
			+ 'typeof("' + this.name + '") in ' 
			+ "('text', 'null'))";
	return sql;
}

schema.IntegerField = function(fieldDef) {
	schema.Field.call(this, fieldDef);
}

schema.IntegerField.prototype = new schema.Field;	

schema.IntegerField.prototype.constraintSQL = function() {
	var sql = "CONSTRAINT chk_" + this.name + " CHECK ("
			+ 'typeof("' + this.name + '") in ' 
			+ "('integer', 'null'))";
	return sql;
}


schema.NumericField = function(fieldDef) {
	schema.Field.call(this, fieldDef);
}

schema.NumericField.prototype = new schema.Field;	

schema.NumericField.prototype.constraintSQL = function() {
	var sql = "CONSTRAINT chk_" + this.name + " CHECK ("
			+ 'typeof("' + this.name + '") in ' 
			+ "('real', 'integer', 'null'))";
	return sql;
}

schema.DatetimeField = function(fieldDef) {
	schema.Field.call(this, fieldDef);
}

schema.DatetimeField.prototype = new schema.Field;	

schema.DatetimeField.prototype.constraintSQL = function() {
	var sql = "CONSTRAINT chk_" + this.name + " CHECK ("
			+ 'julianday("' + this.name + '") is not null'
			+ ' or "' + this.name + '" is null)';
	return sql;
}

schema.Table = function(tableDef) {

	var me = this;
	me.fields = {};

	init(tableDef);

	function init(tableDef) {
		var errMsg = util.format("Table.init(%s) failed. "
					, util.inspect(tableDef));

		assert(_.isObject(tableDef), errMsg);
		assert(_.has(tableDef, "name"), errMsg);
		assert(_.has(tableDef, "fields"), errMsg);
		assert(_.isObject(tableDef.fields), errMsg);

		if ( ! /^\w+$/.test(tableDef.name)) {
			throw new Error(errMsg 
					+ " Table names can only have word-type characters.");
		}

		if( ! _.has(tableDef.fields, "id")) {
			throw new Error(errMsg + " id field missing.");
		}

		if( ! _.has(tableDef.fields, "modified_by")) {
			throw new Error(errMsg + " modified_by field missing.");
		}
		if( ! _.has(tableDef.fields, "modified_on")) {
			throw new Error(errMsg + " modified_on field missing.");
		}

		_.each(tableDef.fields, function(f) {
			me.fields[f.name] = schema.Field.create(f);
		});

		me.name = tableDef.name;

		//non-SQL attributes
		_.each(schema.Table.PROPERTIES, function(f) {
			me[f] = tableDef[f];
		});

		//parse possible JSON
		if (_.isString(me.row_alias)) {
			me.row_alias = JSON.parse(me.row_alias);
		}
	}
}

schema.Table.TABLE = '__tableprops__';
schema.Table.PROPERTIES = ['row_alias', 'label'];
schema.Table.TABLE_FIELDS = ['name']
		.concat(schema.Table.PROPERTIES);

schema.Table.CreateTableSQL = "CREATE TABLE " + schema.Table.TABLE + " ("
		+ " name VARCHAR NOT NULL, "
		+ "	label VARCHAR, "
		+ " row_alias VARCHAR, "
		+ "	PRIMARY KEY (name) "
		+ ");\n\n";

//properties are read-write attributes of a field.
schema.Table.prototype.sqlValue = function(name) {
	switch(name) {
		case 'row_alias': 
			return this.row_alias
				? "'" + JSON.stringify(this.row_alias) + "'"
				: 'null';
		break;			

		default:
			return this[name]
				? "'" + this[name] + "'"
				: 'null';
	}	
}

schema.Table.prototype.deletePropSQL = function() {
	var sql = "DELETE FROM " + schema.Table.TABLE 
			+ " WHERE name = '" + this.name + "'; "

			+ "DELETE FROM " + schema.Field.TABLE 
			+ " WHERE table_name = '" + this.name + "'; ";

	return sql;
}

schema.Table.prototype.insertPropSQL = function() {

	var values = [ this.sqlValue('name') ];

	var props = _.map(schema.Table.PROPERTIES, function(f) {
		return this.sqlValue(f);
	}, this);

	var fields = _.map(schema.Table.TABLE_FIELDS, function(f) {
		return '"' + f + '"';
	});

	var sql = 'INSERT INTO ' + schema.Table.TABLE
			+ ' (' + fields.join(',') + ') ' 
			+ ' VALUES (' + values.join(',') + ',' + props.join(',') + '); ';

	_.each(this.fields, function(f) {
		sql += "\n" + f.insertPropSQL(this);
	}, this);
	//console.log(sql);
	return sql;
}

schema.Table.prototype.foreignKeys = function() {
	return _.select(this.fields, function(f) { 
		return f.fk == 1; 
	});
}

schema.Table.prototype.viewName = function() { return 'v_' + this.name; }
schema.Table.prototype.ftsName = function() { return 'fts_' + this.name; }

schema.Table.prototype.virtualFields = function() {

	return _.map(this.foreignKeys(), function(f) { 
		return f.refName();
	});
}

schema.Table.prototype.viewFields = function() {
//TODO add row_alias field (ref)
	return [schema.Field.REF_NAME]
			.concat( _.pluck(_.values(this.fields), 'name'))
			.concat(this.virtualFields());
}

schema.Table.prototype.createSQL = function() {
	var sql = "CREATE TABLE " + this.name + "(";
	_.each(this.fields, function(f) {
		sql += "\n" + f.toSQL() + ",";
	});
	sql += "\n PRIMARY KEY (id)";

	sql += "\n);";
	log.debug(sql);

	return sql;
}

function tableAlias(name, idx) {
	return name + '_' + idx;
}

schema.Table.prototype.alias = function(idx) {
	return tableAlias(this.name, idx);
}

/* 

use triggers to populate https://github.com/coolaj86/sqlite-fts-demo

sqlite> create trigger orders_ai after insert on orders begin    
...>    insert into fts_orders (docid,content) select id as docid, customers_ || ' yes' as content from v_orders where id = new.id; 
...>end;

*/

schema.Table.prototype.createSearchSQL = function() {
	var viewFields = this.viewFields();

	var sql = 'CREATE VIRTUAL TABLE  ' + this.ftsName() 
			+ ' USING fts4(' +  viewFields.join(',') + 'tokenize=simple "tokenchars=-");\n\n';

	sql += 'CREATE TRIGGER tgr_' + this.name + '_ai'
		+ ' AFTER INSERT ON ' + this.name
		+ ' BEGIN\n INSERT INTO ' + this.ftsName() 
		+ ' (docid, ' + viewFields.join(',') + ') '
		+ ' SELECT id AS docid, ' + viewFields.join(',')
		+ ' FROM ' + this.viewName() + ' WHERE id = new.id;'
		+ '\nEND;\n\n';

	sql += 'CREATE TRIGGER tgr_' + this.name + '_bu '
		+ ' BEFORE UPDATE ON ' + this.name
		+ ' BEGIN\n DELETE FROM ' + this.ftsName() 
		+ ' WHERE docid = old.id;'
		+ '\nEND;\n\n';

	sql += 'CREATE TRIGGER tgr_' + this.name + '_au'
		+ ' AFTER UPDATE ON ' + this.name
		+ ' BEGIN\n INSERT INTO ' + this.ftsName() 
		+ ' (docid, ' + viewFields.join(',') + ') '
		+ ' SELECT id AS docid, ' + viewFields.join(',')
		+ ' FROM ' + this.viewName() + ' WHERE id = new.id;'
		+ '\nEND;\n\n';

	sql += 'CREATE TRIGGER tgr_' + this.name + '_bd '
		+ ' BEFORE DELETE ON ' + this.name
		+ ' BEGIN\n DELETE FROM ' + this.ftsName() 
		+ ' WHERE docid = old.id;'
		+ '\nEND;\n\n';

	return sql;
}

schema.Table.prototype.deleteViewSQL = function() {
	return 'DROP VIEW IF EXISTS ' + this.viewName() + ';\n';
}

schema.Table.prototype.deleteSearchSQL = function() {
	return 'DROP TABLE IF EXISTS ' + this.ftsName() + ';\n'
		+ 'DROP TRIGGER IF EXISTS tgr_' + this.name + '_ai' + ';\n'
		+ 'DROP TRIGGER IF EXISTS tgr_' + this.name + '_bu' + ';\n'
		+ 'DROP TRIGGER IF EXISTS tgr_' + this.name + '_au' + ';\n'
		+ 'DROP TRIGGER IF EXISTS tgr_' + this.name + '_bd' + ';\n'
}

schema.Table.prototype.deleteSQL = function() {
	return 'DROP TABLE IF EXISTS ' + this.name + ';\n';
}

schema.Table.prototype.toJSON = function() {

	var result = {
		name: this.name
	};

	_.each(schema.Table.PROPERTIES, function(f) {
		result[f] = this[f];
	}, this);

	if (this.parents && this.parents.length > 0) {
		result.parents = _.map(this.parents, function(t) {
			return t.name;
		});
	}

	if (this.children && this.children.length > 0) {
		result.children = _.map(this.children, function(t) {
			return t.name;
		});
	}

	result.fields = _.map(this.fields, function(f) {
		return f.toJSON();
	});

	result.fields = _.object(_.pluck(result.fields, 'name'), result.fields);

	//console.log(result);
	return result;
}

schema.Table.prototype.bfsPath = function(joinTable) {
	//console.log(table.name);
	//console.log(joinTable.name);

	if (this == joinTable) return [this, this];
	var visited = {};
	var queue = [];
	queue.push([this]);
	visited[this.name] = true;
	while ( ! _.isEmpty(queue)) {
		var path = queue.shift();
		var table = _.last(path);
		if (table == joinTable) {
			return path;
		}		

		_.each(table.links, function(lt) {
			if (! visited[lt.name]) {
				visited[lt.name] = true;
				var np = path.slice(0); //copy path
				np.push(lt);
				queue.push(np);
			}
		});
	}
	return []; //not found
}

schema.Schema = function(tableDefs) {

	this.tableDefs = tableDefs;
	this.tables = {};
	this.linkedTableLists = [];
}

schema.Schema.prototype.init = function(cbAfter) {
	try {

		this.tables = {};
		_.each(this.tableDefs, function(tableDef) {
			var table = new schema.Table(tableDef);
			this.tables[table.name] = table;			

		}, this);
		this.buildTableGraph();
		//console.log(util.inspect(me.tables, {depth: 99}));

	} catch(err) {
		log.warn("Error in schema.Schema.init " + err);
		//throw err;
		cbAfter(err);
		return;
	}
	cbAfter();
}

schema.Schema.prototype.buildTableGraph = function() {

	var me = this;
	var tables = _.values(me.tables);

	log.debug("Building table graph. Got " + tables.length + " tables.");

	_.each(tables, function(table) {

		var fks = _.filter(table.fields, function(f) {
			return f.fk == 1 && f.name != 'id';
		});

		table.parents = _.filter(tables, function(t) {
			return _.contains(_.pluck(fks, 'fk_table'), t.name);
		});

		//log.debug(table);
	});
	_.each(tables, function(table) {

		table.children = _.filter(tables, function(t) {
			return _.contains(_.pluck(t.parents, 'name'), table.name);
		});

		table.links = table.parents;
		table.links = table.links.concat(table.children);
		
	});

	var linkedTables = [];
	_.each(tables, function(table) {
		
		var linked = false;
		_.each(linkedTables, function(list) {
			if (! linked) {
				log.debug("linking..." + table.name);
				var p = table.bfsPath(me.tables[list[0]]);
				if (p.length > 0) {
					list.push(table.name);
					linked = true;
				}
			}
		});	

		if (! linked) {
			var list = [table.name];
			linkedTables.push(list);
		}		
	});
	//console.log(linkedTables);
	this.linkedTableLists = linkedTables;
}

schema.Schema.prototype.createViewSQL = function(table) {
//TODO create ref field and let 'natural keys' link to the fk_table view
	var me = this;
	
	var joinTables = {};
	var joinSQL = '';
	var distinct = false;
	var fk_fields = [];
	var aliasCount = 0;

	_.each(table.foreignKeys(), function(fk) {
		var fk_table = me.tables[fk.fk_table];
		
		var path = table.bfsPath(fk_table);
		var j = joinTablePath(path, joinTables);
		for(var i = 1; i < path.length; ++i) {
			joinTables[path[i].name] = path[i];
		}

		var jSQL = j.sql;
		if (USE_VIEW) {
			var r = new RegExp('\\b' + fk_table.name + '\\b', 'g');
			jSQL = j.sql.replace(r, fk_table.viewName());
		}			

		joinSQL = joinSQL + jSQL;

		var refName = util.format('%s."%s"', 
						fk_table.viewName(), schema.Field.REF_NAME);

		fk_fields.push(refName + ' AS ' + fk.refName());
		
	});

	var nkValue = _.reduce(table.row_alias, function(memo, nk) {
		var result;
			
		if (nk.indexOf('.') < 0) {
			result = util.format('%s."%s"', table.name, nk);

		} else {
			var nkTable = me.tables[nk.split('.')[0]]; 	
			var nkField = nk.split('.')[1]; 	

			result = util.format('%s."%s"', nkTable.viewName(), nkField);

			var path = table.bfsPath(nkTable);
			var j = joinTablePath(path, joinTables);
			for(var i = 1; i < path.length; ++i) {
				joinTables[path[i].name] = path[i];
			}

			var jSQL = j.sql;
			if (USE_VIEW) {
				var r = new RegExp('\\b' + nkTable.name + '\\b', 'g');
				jSQL = j.sql.replace(r, nkTable.viewName());
			}			

			joinSQL = joinSQL + jSQL;

		}	
		if ( ! _.isEmpty(memo)) {
			result = memo + " || ' ' || " + result;
		}
		return result;
	}, '');

	var fkValue = util.format("'(' || %s.id || ')'", table.name); 
	nkValue = nkValue.length > 0 
			? nkValue + ' || ' + fkValue 
			: fkValue;

/*
	_.each(table.foreignKeys(), function(fk) {
		++aliasCount;	
		//log.debug(fk);
		var fk_table = me.tables[fk.fk_table];
		var nkValue = _.reduce(fk_table.row_alias, function(memo, nk) {
			var result;
			
			if (nk.indexOf('.') < 0) {
				var fkTableName = (table == fk_table) ?
									table.alias(aliasCount) : fk_table.name;
				
				result = util.format('%s."%s"', fkTableName, nk);
				var path = table.bfsPath(fk_table);
				var j = joinTablePath(path, joinTables);
				joinSQL = joinSQL + j.sql;
				for(var i = 1; i < path.length; ++i) {
					joinTables[path[i].name] = path[i];
				}
			} else {
				var nkTable = nk.split('.')[0]; 	
				var nkField = nk.split('.')[1]; 	
				result = util.format('%s."%s"', nkTable, nkField);

				var path = table.bfsPath(me.tables[nkTable]);
				var j = joinTablePath(path, joinTables);
				joinSQL = joinSQL + j.sql;
				for(var i = 1; i < path.length; ++i) {
					joinTables[path[i].name] = path[i];
				}
			}	
			if ( ! _.isEmpty(memo)) {
				result = memo + " || ' ' || " + result;
			}
			return result;
		}, '');
		var fkValue = util.format("'(' || %s.%s || ')'", table.name, fk.name); 
		nkValue = nkValue.length > 0 
				? nkValue + ' || ' + fkValue 
				: fkValue;
		fk_fields.push(nkValue + ' AS ' + fk.refName());
			
	});
*/

	var fieldSQL = _.map(table.fields, function(f) {
		return util.format('%s."%s"', table.name, f.name);
	}).join(',');

	fieldSQL = fieldSQL + ',' + nkValue + ' AS ' + schema.Field.REF_NAME;

	if (fk_fields.length > 0) {
		fieldSQL = fieldSQL + ',' + fk_fields.join(',');
	}

	return 'CREATE VIEW ' + table.viewName() 
		+  ' AS SELECT ' + fieldSQL + ' FROM ' + table.name 
		+ joinSQL + ';';
}

schema.Schema.prototype.createSQL = function() {
	var sql = schema.Table.CreateTableSQL
			+ schema.Field.CreateTableSQL;

	_.each(this.tables, function(t) {
		sql += t.createSQL() + '\n\n';
		sql += this.createViewSQL(t) + '\n\n';
		sql += t.createSearchSQL() + '\n\n';
		sql += t.insertPropSQL() + '\n\n';
	}, this);

	log.debug(sql);
	return sql;
}

schema.Schema.prototype.get = function() {

	assert(_.isObject(this.tables)); 
	
	var tableDefs = _.map(this.tables, function(table) {
		return table.toJSON();
	});

	tableDefs = _.object(_.pluck(tableDefs, 'name'), tableDefs);
	return {
		'tables': tableDefs,
		'joins': this.linkedTableLists
	};		
}

schema.Schema.prototype.filterSQL = function(table, filterClauses) {

	var me = this;
	var joinTables = {};
	var joinSQL = '';
	var whereSQL = " WHERE 1=1";
	var distinct = false;
	var sql_params = [];

	_.each(filterClauses, function(filter) {

		filter.table = filter.table || table.name;

		var allowedFilterFieldNames = (filter.table == table.name) ? 
				table.viewFields() : 
				_.pluck(me.tables[filter.table].fields, 'name');

		allowedFilterFieldNames.push(filter.table);

		assert(_.contains(allowedFilterFieldNames, filter.field), 
			util.format("filter field %s.%s unknown", 
				filter.table, filter.field));

		if (filter.table != table.name) {

			var path = table.bfsPath(me.tables[filter.table]);
			var j = joinTablePath(path, joinTables);
			
			var jSQL = j.sql;
			if (USE_VIEW) {
				var r = new RegExp('\\b' + table.name + '\\b', 'g');
				jSQL = j.sql.replace(r, table.viewName());
			}			

			joinSQL = joinSQL + jSQL;
			distinct = distinct || j.distinct;
			for(var i = 1; i < path.length; ++i) {
				joinTables[path[i].name] = path[i];
			}
		}


		var filterTable = (filter.table == table.name && USE_VIEW) ?
							table.viewName() : filter.table;

		var comparatorOperators = {
			'eq' : '=', 
			'ne' : '!=',	
			'ge': '>=', 
			'gt': '>', 
			'le': '<=', 
			'lt': '<'
		};

		if (comparatorOperators[filter.operator]) {

			whereSQL = whereSQL + util.format(" AND %s.%s %s ?", 
									filterTable, filter.field, 
									comparatorOperators[filter.operator]
								);
				
			sql_params.push(filter.value);

		} else if (filter.operator == 'in') {

			var inParams = _.times(filter.value.length, function(fn) { 
					return "?"; 
			});

			whereSQL = whereSQL + util.format(" AND %s.%s IN (%s)",
									filterTable, filter.field,
									inParams.join(',')
								);

			sql_params = sql_params.concat(filter.value); 

		} else if (filter.operator == 'search') {
			//if ( ! joinTables[me.tables[filter.table].ftsName()]) {
			//dosnt work, you cant search two different criteria
				joinSQL = joinSQL + ' INNER JOIN ' 
					+ me.tables[filter.table].ftsName()
					+ ' ON ' + util.format('%s.docid = %s.id', 
									me.tables[filter.table].ftsName(),
									filterTable);

				joinTables[me.tables[filter.table].ftsName()] 
					= me.tables[filter.table].ftsName(); 
			//}

			whereSQL = whereSQL + util.format(" AND %s.%s MATCH ?", 
									me.tables[filter.table].ftsName(),
									//check if full row search
									filter.field == filter.table ? 
										me.tables[filter.table].ftsName() :
										filter.field
								); 	

			sql_params.push(filter.value);

		} else {
			//unknown op
		}

	});

	return { 
		join: joinSQL,
		where: whereSQL,
		distinct: distinct,
		params: sql_params
	};
}

schema.Schema.prototype.checkFields = function(table, fieldNames) {
	_.each(fieldNames, function(f) {
		if ( ! _.contains(table.viewFields(), f)) {
			throw new Error("unknown field '" + f + "'");
		}			
	});		
}


schema.Schema.prototype.fieldSQL = function(table, fields) {
	var tableName = USE_VIEW ? table.viewName() : table.name;

	if (fields == '*') {
		fields = _.map(table.fields, function(f) {
			return util.format('%s."%s" as %s', tableName, f.name, f.name);
		});
		if (USE_VIEW) {
			var fk_fields =_.map(table.foreignKeys(), function(f) {
				return util.format('%s."%s" as %s', 
							tableName, f.refName(), f.refName());
			});
			fields.push(util.format('%s."%s" as %s', 
				tableName, schema.Field.REF_NAME, schema.Field.REF_NAME));
			fields = fields.concat(fk_fields);
		}
	} else {
		this.checkFields(fields);
		fields = _.map(fields, function(f) {
			return util.format('%s."%s" as %s', tableName, f, f);
		});	
	}		

	return fields.join(",");
}

schema.Schema.prototype.orderSQL = function(table, orderClauses) {
	var tableName = USE_VIEW ? table.viewName() : table.name;

	var orderSQL;
	if ( ! _.isEmpty(orderClauses)) {	
		
		var orderSQL = _.reduce(orderClauses, function(memo, order, idx) {
			var orderField = _.keys(order)[0];
			var orderDir = _.values(order)[0].toUpperCase();
			
			assert(_.contains(table.viewFields(), orderField),
				  util.format("order field '%s' unknown", orderField));

			assert(_.contains(['ASC', 'DESC'], orderDir),
				  util.format("order dir '%s' invalid", orderDir));
			
			var result = memo + util.format('%s."%s" %s', 
							tableName, orderField, orderDir);

			if (idx < orderClauses.length-1) result = result + ',';
			return result;
			
		}, ' ORDER BY ');
		
	} else {
		//most recently modified first
		orderSQL = " ORDER BY " + tableName + ".id DESC";
	}
	return orderSQL;

}

schema.Schema.prototype.selectSQL = function(table, filterClauses, fields, orderClauses, limit, offset, distinct) {
	assert(_.isArray(filterClauses), "arg 'filterClauses' is array");
	assert(_.isObject(table), "arg 'table' is object");
	assert(_.isArray(orderClauses), "arg 'orderClauses' is array");
	
	var tableName = USE_VIEW ? table.viewName() : table.name;

	if (_.isNumber(limit)) limit = limit.toString();
	assert(_.isString(limit), "arg 'limit' is string");

	var filterSQL = this.filterSQL(table, filterClauses);
	var orderSQL = this.orderSQL(table, orderClauses);
	var distinctSQL = (filterSQL.distinct || distinct) ? ' DISTINCT ' : ' ';
	var fieldSQL = this.fieldSQL(table, fields);
	var limitSQL = ' LIMIT ' + limit;
	var offsetSQL = ' OFFSET ' + offset;

	var sql = 'SELECT' + distinctSQL + fieldSQL + ' FROM ' + tableName 
			+ ' ' + filterSQL.join + filterSQL.where + orderSQL + limitSQL + offsetSQL;

	log.debug(sql, filterSQL.params);

	var countSQL = 'SELECT COUNT(*) as count FROM ('
				+ 'SELECT' + distinctSQL + fieldSQL + ' FROM ' + tableName 
				+ ' ' + filterSQL.join + filterSQL.where + ')';

	log.debug(countSQL);

	return {'query': sql, 'params': filterSQL.params, 'countSql': countSQL};
}

/******* start file ops *******/

schema.Schema.prototype.update = function(delTables, addTables, dbFile, cbAfter) {
	var me = this;

	var newTableDefs = _.map(_.reject(me.tables, function(t) {
			return _.find(delTables, function(dt) {
				return dt.name == t.name;
			})
		}), function(table) {
		return table.toJSON();	 
	}).concat(addTables);

	//console.log(_.pluck(newTableDefs, "name"));

	var newSchema = new schema.Schema(newTableDefs);
	newSchema.init(function(err) {
		if (err) {
			cbAfter(err);
			return;
		}

		var sql = '';

		sql = _.reduce(delTables, function(memo, t) {
			return memo + '\n' 
				+ me.tables[t.name].deleteSQL()
				+ me.tables[t.name].deleteViewSQL()
				+ me.tables[t.name].deleteSearchSQL()
				+ me.tables[t.name].deletePropSQL()
				;
		}, sql);

		sql = _.reduce(addTables, function(memo, t) {
			var table = newSchema.tables[t.name];
			return memo + '\n'
				+ table.createSQL() + '\n'
				+ newSchema.createViewSQL(table) + '\n'
				+ table.createSearchSQL() + '\n'
				+ table.insertPropSQL() + '\n'
				;
		}, sql);

//TODO check if we can get rid of this now
		var redoViewTables = _.filter(newSchema.tables, function(t) {
			var dup = _.some(addTables, function(a) {
				return t.name == a.name;
			})
			if (dup) return false;

			//get fk fields that reference an updated table
			return _.some(t.fields, function(f) {
				return _.some(addTables, function(a) {
					return a.name == f.fk_table;
				});
			});
		});
		//console.log(redoViewTables);

		sql = _.reduce(redoViewTables, function(memo, table) {
			return memo + '\n'
				+ table.deleteViewSQL() + '\n'
				+ table.deleteSearchSQL() + '\n'
				+ newSchema.createViewSQL(table) + '\n'
				+ table.createSearchSQL() + '\n'
				;
		}, sql);

		log.debug(sql);

		var db = new sqlite3.Database(dbFile
			, sqlite3.OPEN_READWRITE
			, function(err) {
				if (err) {
					cbAfter(err);
					return;
				}
				db.serialize(function() {
					db.run("PRAGMA foreign_keys = ON;");
					db.run("BEGIN TRANSACTION");
					db.exec(sql, function(err) {
						if (err == null) {
							db.run("COMMIT TRANSACTION");
							me.tableDefs = newTableDefs;
							me.init(function(err) { 
								cbAfter(err); 
							});
						} else {
							log.warn("schema.Table.update() failed. " + err);
							db.run("ROLLBACK TRANSACTION");
							cbAfter(err);
						}
					});
				});
				db.close();
		}); //new Database

	});

}

schema.Schema.prototype.create = function(dbFile, cbAfter) {
	var me = this;
	var tmpFile = path.join(global.tmp_dir,
						tmp.tmpNameSync({template: 'dl-XXXXXX.sqlite'}));

	var db = new sqlite3.Database(tmpFile 
		, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
		, function(err) {
			if (err) {
				cbAfter(err);
				return;
			}
			db.exec(me.createSQL(), function(err) {
				if (err) {
					log.warn("schema.Schema.create() failed. " + err);	
					fs.unlink(tmpFile);
					cbAfter(err);
					return;
				}
				log.debug('rename ' + tmpFile + ' to ' + dbFile);
				fs.rename(tmpFile, dbFile, function(err) {
					cbAfter(err);
				});
			});
			db.close();
	});
}

schema.Schema.remove = function(dbFile, cbAfter) {
	fs.unlink(dbFile, function(err) {
		if (err) {
			log.warn("schema.Schema.remove() failed. " + err);	
		}
		cbAfter(err);
	});
}

schema.Schema.prototype.read = function(dbFile, cbAfter) {
	log.debug("schema.Schema.prototype.read " + dbFile);
	var me = this;
	var db = new sqlite3.Database(dbFile
						, sqlite3.OPEN_READWRITE
						, function(err) {
		if (err) {
			log.error("Schema.read() failed. Could not open '" 
				+ dbFile + "'");
			cbAfter(err);
			return;
		}

		var fields = _.map(schema.Table.TABLE_FIELDS, function(f) {
			return '"' + f + '"';
		});
		var sql = 'SELECT ' + fields.join(',') 
				+ ' FROM ' + schema.Table.TABLE;

		//read table properties 
		db.all(sql, function(err ,rows) {

			if (err) { 
				log.error("Get table defs failed. " + err);
				cbAfter(err);
				return;
			} 

			//console.dir(rows);
			var tables = _.object(_.pluck(rows, 'name'), rows);
			me.tableDefs = tables;

			//handle empty schema
			if (rows.length == 0) {
				me.init(cbAfter);
			}
				
			var fields = _.map(schema.Field.TABLE_FIELDS, function(f) {
				return '"' + f + '"';
			});
			var sql = 'SELECT ' + fields.join(',') 
					+ ' FROM ' + schema.Field.TABLE;

			//read field properties 
			db.all(sql, function(err ,rows) {
				
				var tableNames = _.uniq(_.pluck(rows, 'table_name'));

				_.each(tableNames, function(tn) {
					tables[tn]['fields'] = {};
				});

				_.each(rows, function(r) {
					tables[r.table_name].fields[r.name] = r;
				});


				var doAfter = _.after(2*tableNames.length, function() {
					//after executing two SQL statements per table
					me.tableDefs = tables;
					me.init(cbAfter);
				});

				//read field sql definition 
				_.each(tableNames, function(tn) {
					var sql = util.format("PRAGMA table_info(%s)", tn);
					//console.log(sql);
					db.all(sql, function(err, rows) {
						if (err) {
							log.error(sql + ' failed.');
							cbAfter(err, tables);
							return;

						} 
						_.each(rows, function(r) {
							//console.log(r);
							_.extend(tables[tn].fields[r.name], r);	
						});
						doAfter();
					});
				});

				//read fk sql definition 
				_.each(tableNames, function(tn) {
					var sql = util.format("PRAGMA foreign_key_list(%s)", tn);
					db.all(sql, function(err, rows) {
						if (err) {
							log.error(sql + ' failed.');
							cbAfter(err, tables);
							return;

						}
						_.each(rows, function(r) {
							//console.log(r);
							_.extend(tables[tn].fields[r.from], {
								fk: 1,
								fk_table: r.table,
								fk_field: r.to
							});
						});
						doAfter();
					});
				});
			});
		});
	});
}

function joinTablePath(tables, exclude) {
	var joinClause = "";
	var distinct = false;
	for(var i = 0;i < tables.length - 1; ++i) {
		var t = tables[i];
		var pt = tables[i+1];

		if (exclude[pt.name]) continue; 

		var fk = _.find(t.fields, function(f) {
			return f.fk_table == pt.name;
		});

		if (fk) {

			var ptName = pt.name;
			if (t == pt) {
				joinClause = joinClause 
				  + util.format(" INNER JOIN %s as %s ON %s.%s = %s.id", 
								pt.name, tableAlias(pt.name, 1),
								t['name'], fk.name, 
								tableAlias(pt.name, 1));
			} else {
				joinClause = joinClause 
				  + util.format(" INNER JOIN %s ON %s.%s = %s.id", 
								pt.name, 
								t['name'], fk.name, 
								pt.name);
			}

		} else {
			// pt is child or subtype			
			var pfk = _.find(pt.fields, function(pf) {
				return pf.fk_table == t.name;
			});

			joinClause = joinClause 
				  + util.format(" INNER JOIN %s ON %s.%s = %s.id", 
								pt['name'], 
								pt['name'], pfk.name, 
								t['name']);
			distinct = true;
		}
			
		//console.log(joinClause);
	}
	return { 'sql': joinClause, 'distinct': distinct };
}


exports.Schema = schema.Schema;

