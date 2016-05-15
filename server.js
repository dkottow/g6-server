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

var url = require('url');
var bunyan = require('bunyan');

/*
var BunyanLoggly = require('bunyan-loggly');
var loggly_stream = new BunyanLoggly({
	subdomain: 'dkottow'
	, token: 'ea829b15-4675-49a7-8c42-f227d0b9313f'
}, 5, 500);
*/

global.log = bunyan.createLogger({
	name: 'g6.server'
	, src: true
	, serializers: bunyan.stdSerializers
	, streams: [
		{
			stream: process.stdout
			, level: 'info'
		} 
		, {
			type: 'rotating-file'
			, path: 'logs/g6.rest-server.json'
			, level: 'debug'
			, period: '1d'
		}
/*
		, {
			stream: loggly_stream
			, type: 'raw'
			, level: 'debug'
		} 
*/
	]
});

var app = require('./app/app.js').app;

var log = global.log.child({'mod': 'g6.server.js'});

var config = {
	'ip'	:  'localhost',
	//'ip'	:  '192.168.1.38',
	'port'	: 3000, 
}

if (process.env.DONKEYLIFT_API) {
	var u = url.parse(process.env.DONKEYLIFT_API);
	config.ip = u.hostname;
	config.port = u.port;

} else if (process.env.OPENSHIFT_DATA_DIR) {
	config.ip = process.env.OPENSHIFT_NODEJS_IP;
	config.port = process.env.OPENSHIFT_NODEJS_PORT;

} else if (process.env.C9_USER) {
	config.ip = process.env.IP;
	config.port = process.env.PORT;
}

app.init(function(err) {

	if (err) throw err;

	app.listen(config.port, config.ip, function() {
		log.info({config: config}, "app listen() - listening.");
		//console.log("Started server on " + config.ip + ":" + config.port);
	});

});

