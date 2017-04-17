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
var assert = require('assert');

var log = require('../log.js').log;

var SqlHelperSqlite = {
	Field: {},
	Table: {},
	Schema: {}
}



SqlHelperSqlite.Schema.PragmaSQL = "PRAGMA journal_mode=WAL;\n\n";

SqlHelperSqlite.Schema.createPropsTableSQL = function(name) {
	return "CREATE TABLE " + name + " ("
		+ " name VARCHAR NOT NULL, "
		+ "	value VARCHAR, "
		+ "	PRIMARY KEY (name) "
		+ ");\n\n"
}

SqlHelperSqlite.EncloseSQL = function(name) {
	return '"' + name + '"';
}


SqlHelperSqlite.Table.createPropsTableSQL = function(name) {
	return "CREATE TABLE " + name + " ("
		+ " name VARCHAR NOT NULL, "
		+ "	props VARCHAR, "
		+ " disabled INTEGER DEFAULT 0, "
		+ "	PRIMARY KEY (name) "
		+ ");\n\n";
}

/* 

use triggers to populate FTS full text search
see https://github.com/coolaj86/sqlite-fts-demo

sqlite> create trigger <table>_ai after insert on <table> 
		begin    
			insert into fts_orders (docid,content) 
			select id as docid, <concat fields> AS content from <table> 
			where id = new.id; 
		end;
*/

SqlHelperSqlite.Table.dropTriggerSQL = function(table) {
	var sql = 'DROP TRIGGER IF EXISTS tgr_' + table.name + '_ai;\n'
		+ 'DROP TRIGGER IF EXISTS tgr_' + table.name + '_bu;\n'
		+ 'DROP TRIGGER IF EXISTS tgr_' + table.name + '_au;\n'
		+ 'DROP TRIGGER IF EXISTS tgr_' + table.name + '_bd;\n\n';

	return sql;
}

SqlHelperSqlite.Table.createTriggerSQL = function(table) {

	//group foreign keys by referenced table to number referenced tables
	//e.g. vra_team as vra_team01, vra_team as vra_team02 etc.
	var fk_groups = _.groupBy(table.foreignKeys(), function(fk) {
		return fk.fk_table;
	});

	var fkSQL = _.map(table.foreignKeys(), function(fk) {
		return table.fkAliasSQL(fk, 
						fk_groups[fk.fk_table].indexOf(fk) + 1);
	});

	var rowAliasSQL = table.rowAliasSQL();

	var tables = [table.name, rowAliasSQL.table];
	var fkAlias = _.map(fkSQL, function(ref) {
		return util.format('%s AS %s', ref.table, ref.alias); 
	});

	tables = [table.name, rowAliasSQL.table].concat(fkAlias);

	var fieldContent = _.map(table.fields(), function(f) {
		return util.format("COALESCE(%s.%s, '')", table.name, SqlHelperSqlite.EncloseSQL(f.name));
	});

	var refCoalesceFn = function(t) {
		return util.format("COALESCE(%s.ref, '')", t);
	};

	fieldContent.push(refCoalesceFn(rowAliasSQL.table));

	_.each(fkSQL, function(fk) {
		fieldContent.push(refCoalesceFn(fk.alias));
	});

	var refClauses = _.pluck(fkSQL, 'clause');
	refClauses = [ rowAliasSQL.clause ].concat(refClauses);

	var tableId = table.name + '.id';

	var content = fieldContent.join(" || ' ' || ");	

	var sql = 'CREATE TRIGGER tgr_' + table.name + '_ai'
		+ ' AFTER INSERT ON ' + table.name
		+ ' BEGIN\n INSERT INTO ' + table.ftsName() + ' (docid, content) '
		+ ' SELECT ' + tableId + ' AS docid, ' + content + ' as content'
		+ ' FROM ' + tables.join(', ') 
		+ ' WHERE ' + tableId + ' = new.id'
		+ ' AND ' + refClauses.join(' AND ') + ';'
		+ '\nEND;\n\n';

	sql += 'CREATE TRIGGER tgr_' + table.name + '_bu '
		+ ' BEFORE UPDATE ON ' + table.name
		+ ' BEGIN\n DELETE FROM ' + table.ftsName() 
		+ ' WHERE docid = old.id;'
		+ '\nEND;\n\n';

	sql += 'CREATE TRIGGER tgr_' + table.name + '_au'
		+ ' AFTER UPDATE ON ' + table.name
		+ ' BEGIN\n INSERT INTO ' + table.ftsName() + ' (docid, content) '
		+ ' SELECT ' + tableId + ' AS docid, ' + content + ' as content'
		+ ' FROM ' + tables.join(', ') 
		+ ' WHERE ' + tableId + ' = new.id'
		+ ' AND ' + refClauses.join(' AND ') + ';'
		+ '\nEND;\n\n';

	sql += 'CREATE TRIGGER tgr_' + table.name + '_bd '
		+ ' BEFORE DELETE ON ' + table.name
		+ ' BEGIN\n DELETE FROM ' + table.ftsName() 
		+ ' WHERE docid = old.id;'
		+ '\nEND;\n\n';

	return sql;
}

SqlHelperSqlite.Table.createSearchSQL = function(table) {
	var createSQL = 'CREATE VIRTUAL TABLE ' + table.ftsName() 
			+ ' USING fts4(content, tokenize=simple "tokenchars=-");\n\n';
	var triggerSQL = SqlHelperSqlite.Table.createTriggerSQL(table);
	var sql = createSQL + triggerSQL;
	log.trace({ sql: sql }, 'Table.createSearchSQL()');
	return sql;
}


/********** Field **********/

SqlHelperSqlite.Field.createPropsTableSQL = function(name) {
	return " CREATE TABLE " + name + " ("
		+ ' table_name VARCHAR(256) NOT NULL, '
		+ ' name VARCHAR NOT NULL, '
		+ ' props VARCHAR, '
		+ ' disabled INTEGER DEFAULT 0, '
		+ ' PRIMARY KEY (name, table_name) '
		+ ");\n\n";
}
		
SqlHelperSqlite.Field.defaultSQL = function(field) {

	if (_.contains(['mod_on', 'add_on'], field.name)) {
		return "DEFAULT(datetime('now'))";

	} else if (_.contains(['mod_by', 'add_by'], field.name)) {
		return "DEFAULT 'sql'";

	} else {
		return '';
	}
}

SqlHelperSqlite.Field.foreignKeySQL = function(field) {
	return field.fk 
		? util.format("REFERENCES %s(%s)", field.fk_table, field.fk_field)
		: "";
}



exports.SqlHelperSqlite = SqlHelperSqlite;
