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

var fs = require('fs');
var path = require('path');
var util = require('util');

var Schema = require('./Schema.js').Schema;
var Database = require('./Database.js').Database;

var log = global.log.child({'mod': 'g6.Account.js'});

global.sqlite_ext = global.sqlite_ext || '.sqlite';

function fileExists(path) {
	try {
		var stat = fs.statSync(path);
		return true;

	} catch(err) {
		if (err.code == 'ENOENT') return false;
		else throw new Error(err);
	}
}

function Account(baseDir) {
	this.baseDir = baseDir;
	this.name = path.basename(baseDir);
	this.databases = {};

	log.debug("new Account " + this.name);
}

Account.prototype.init = function(cbAfter) {
	var me = this;

	log.debug({baseDir: me.baseDir}, "Account.init()...");
	//serve each database
	fs.readdir(me.baseDir, function(err, files) {
		log.debug('Scanning ' + me.baseDir);

		if (err) {
			log.error({err: err}, "Account.init failed.");
			cbAfter(err);
			return;
		}


		var dbFiles = files.filter(function (file) {
			return (path.extname(file) == global.sqlite_ext);
		});

		log.debug({dbFiles: dbFiles});

		dbFiles.forEach(function (file, i, files) {
			log.debug({dbFile: file}, "init");

			var name = path.basename(file, global.sqlite_ext);
			var dbFile = path.join(me.baseDir, file);					

			me.databases[name] = new Database(dbFile);

			me.databases[name].init(function() { 
				if (i == files.length - 1) {
					log.debug("...Account.init()");
					cbAfter();
					return;
				}
			});
		});

		//handle empty dir
		if (dbFiles.length == 0) {
			log.debug("Account is empty.");
			cbAfter();
		}
		

	});
}

Account.prototype.get = function(cbAfter) {
	var me = this;

	var result = {
		name: me.name,
		databases: {}
	};

	var doAfter = _.after(_.size(me.databases), function() {
		cbAfter(null, result);
	});

	_.each(this.databases, function(db) {
		db.getSchema({skipCounts: true}, function(err, schemaData) {
			_.each(schemaData.tables, function(t) { 
				delete t.fields; 
			});
			result.databases[schemaData.name] = schemaData;
			doAfter();
		});
	});

	//handle empty account
	if (_.size(me.databases) == 0) {
		cbAfter(null, result);
	};
}

Account.prototype.writeSchema = function(schemaData, options, cbAfter) {
	var me = this;
	var name = schemaData.name;

	if (! cbAfter) {
		cbAfter = options;
		options = {};
	}
	options = options || {};		

	var createSchemaFn = function() {
		var dbFile = util.format('%s/%s', me.baseDir, 
					name + global.sqlite_ext);

		var newSchema = new Schema();
		newSchema.init(schemaData);

		newSchema.write(dbFile, function(err) {
			if (err) {
				cbAfter(err, null);
				return;
			} 
			log.info("Created database file " + dbFile);
			var newDb = new Database(dbFile, {schema: newSchema});	
			me.databases[name] = newDb;
			cbAfter(null, newDb);
		});
	}

	var db = me.databases[name];
	if (db) {
			
		db.isEmpty(function(err, isEmpty) {

			if (isEmpty) {
				createSchemaFn();

			} else {
				var err = new Error(util.format(
					"Database %s exists and is not empty.", name
				));
				cbAfter(err, null);
			}	
		});

	} else {
		createSchemaFn();
	}
}

Account.prototype.removeDatabase = function(name, options, cbAfter) {
	var me = this;

	if (! cbAfter) {
		cbAfter = options;
		options = {};
	}
	options = options || {};		
	var checkEmpty = ! options.force; 

	var removeDatabaseFn = function() {
		var dbFile = me.databases[name].dbFile;
		Schema.remove(dbFile, function(err) {
			if (err) {
				cbAfter(err, false);
				return;
			}
			log.info("Deleted database file " + dbFile);
			delete me.databases[name];
			cbAfter(null, true);
		});
	}

	var db = me.databases[name];
	if (db) {
		if (checkEmpty) {	
			db.isEmpty(function(err, isEmpty) {

				if (isEmpty) {
					removeDatabaseFn();

				} else {
					var err = new Error(util.format(
						"Database %s is not empty.", name
					));
					cbAfter(err, false);
				}	
			});
		} else {
			removeDatabaseFn();
		}
	} else {
		var err = new Error(util.format(
			"Database %s not found.", name
		));
		cbAfter(err, false);
	}
}

exports.Account = Account;
