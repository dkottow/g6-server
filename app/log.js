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

var path = require('path');
var winston = require('winston');

function init() {
	var logfile = path.join(global.config.logdir, 'donkey-error-log.json');
	if ( ! global.init_log) {

		winston.loggers.add('dl', {
			console: {
				level: 'debug'
				, timestamp: true
				, colorize: true
				//, prettyPrint: prettyPrint
    		}
		    , file: {
				filename: logfile
				, level: 'error'
				, timestamp: true
				, tailable: true
				, maxFiles: 10
				, maxsize: 1000000
    		}

		});

		winston.loggers.get('dl').rewriters.push(rewriteRequest);

		global.init_log = true;
	}
}

var log = {

	log: function(level, arg1, arg2) {
		if (arg2) {
			winston.loggers.get('dl').log(level, arg2, arg1);
		} else {
			winston.loggers.get('dl').log(level, arg1);
		}
	},

	error: function(obj, msg) {
		this.log('error', obj, msg);		
	},

	warn: function(obj, msg) {
		this.log('warn', obj, msg);		
	},

	info: function(obj, msg) {
		this.log('info', obj, msg);
	},

	debug: function(obj, msg) {
		this.log('debug', obj, msg);
	},

	trace: function(obj, msg) {
		this.log('silly', obj, msg);
	},
}

var rewriteRequest = function(level, msg, obj) {

	var result = obj;	
	if (obj && obj.req) {
		result.req = {
			url: obj.req.url
			, method: obj.req.method			
		};
		if (obj.req.user) {
			result.req.user = {
				name: obj.req.user.name
				, account: obj.req.user.account
				, role: obj.req.user.role
				, admin: obj.req.user.admin
			}
		} else {
			result.req.user = null;
		}
	}
	return result;
}

var prettyPrint = function(obj) {
	return JSON.stringify(obj);
}

init();

exports.log = log;

