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

var Account = require('./Account.js').Account;

var log = global.log.child({'mod': 'g6.AccountManager.js'});

function AccountManager() {
	this.path = global.data_dir;
	this.accounts = {};
}

AccountManager.prototype.init = function(cbAfter) {
	var me = this;

	//make sure tmp dir exists
	try { fs.mkdirSync(global.tmp_dir); } 
	catch(err) { 
		//ignore EEXIST
		if (err.code != 'EEXIST') {
			log.error({err: err, tmp_dir: global.tmp_dir}, 
				'app.init() failed. mkdirSync()');
			cbAfter(err);
			return;
		}
	} 

	//read all accounts
	fs.readdir(me.path, function (err, files) {
    	if (err) {
			log.error({err: err, rootDir: me.path}, 
				'AccountManager.init() failed. readdir()');
        	cbAfter(err);
			return;
    	}

	    var accountDirs = files.map(function (file) {
    	    return path.join(me.path, file);
	    }).filter(function (file) {
    	    return fs.statSync(file).isDirectory();
	    });

		var doAfter = _.after(accountDirs.length, function() {
			log.debug("...AccountManager.init()");
			cbAfter();
			return;
		});
		
		accountDirs.forEach(function (dir, i, subDirs) {
			log.debug(dir + " from " + subDirs);

			var account = new Account(dir);
			me.accounts[account.name] = account;	
			account.init(function(err) {
				doAfter();
			});
		});
	});
}

AccountManager.prototype.list = function() {
	var result = {};
	result.accounts = _.map(this.accounts, function(ac) {
		return { name: ac.name };
	});
	return result;
}

AccountManager.prototype.get = function(name) { 
	return this.accounts[name];
}

AccountManager.prototype.create = function(name, cbAfter) {
	var me = this;
	var accountDir = path.join(this.path, name);
	if (fileExists(accountDir)) {
		var err = new Error(util.format("Account %s exists.", name));
		log.warn({err: err}, "AccountManager.create()");
		cbAfter(err, null);
		return;
	}

	fs.mkdir(accountDir, function(err) {
		if (err) {
			log.error({err: err}, "AccountManager.create()");
			cbAfter(err, null);
			return;
		}

		var account = new Account(accountDir);
		account.init(function(err) {
			me.accounts[name] = account;
			cbAfter(null, account);
		});
	});
}

function fileExists(path) {
	try {
		var stat = fs.statSync(path);
		return true;

	} catch(err) {
		if (err.code == 'ENOENT') return false;
		else throw new Error(err);
	}
}

exports.AccountManager = AccountManager;
