var express = require('express');
var bodyParser = require('body-parser');
var _ = require('underscore');

var fs = require('fs');
var path = require('path');
var util = require('util');
var url = require('url');

global.log = global.log || require('bunyan').createLogger({
	name: 'g6.server',
	level: 'debug',
	src: true,
	stream: process.stderr
});


//max number of rows queried by any SELECT
global.row_max_count = 1000;
global.sqlite_ext = '.sqlite';

var data_dir = 'data';
if (process.env.OPENSHIFT_DATA_DIR) {
	data_dir = process.env.OPENSHIFT_DATA_DIR + data_dir;
}

global.tmp_dir = path.join(data_dir, 'tmp');

/*** end globals ***/

var AccountController = require('./AccountController.js').AccountController;

var app = express();

var log = global.log.child({'mod': 'g6.app.js'});

var accountControllers = {};
function serveAccounts(rootDir) {
	var router = new express.Router();
	fs.readdir(rootDir, function (err, files) {
    	if (err) {
        	throw err;
    	}

	    files.map(function (file) {
    	    return path.join(rootDir, file);
	    }).filter(function (file) {
    	    return fs.statSync(file).isDirectory();
	    }).forEach(function (dir, i, subDirs) {
			log.debug(dir + " from " + subDirs);
			var url = "/" + path.basename(dir)
			var controller = new AccountController(router, url, dir);
			controller.init(function() {
				if (i == subDirs.length - 1) {

					router.get('/', function(req, res) {
						log.info(req.method + ' ' + req.url);
						var accounts = _.map(accountControllers, function(ac) {
							return ac.url;
						});

						res.send({ accounts : accounts });
					});
					app.use('/', router);

					log.info('done.');
				}
			});
			accountControllers[controller.name] = controller;
		});
	});
}

/*
app.listen(config.port, config.ip, function() {
	log.info("Started server on " + config.ip + ":" + config.port);
});
*/

app.use(bodyParser.json()); //json parsing 

//enable CORS
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE'); 
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

//make sure tmp dir exists
try { fs.mkdirSync(global.tmp_dir); } 
catch(err) { if (err.code != 'EEXIST') throw(err); } //ignore EEXIST

serveAccounts(data_dir);

app.get('/admin/reset', function(req, res) {
	//replace our express router by a new one calling serveDirectoryTree
	for(var i = 0;i < app._router.stack.length; ++i) {
		var route = app._router.stack[i];
		if (route.handle.name == 'router') {
			app._router.stack.splice(i, 1);
			serveDirectoryTree(data_dir);
			break;
		}
	}
	res.send('done.');
});

app.use(function(err, req, res, next){
	log.error(err);
	res.send(500, err.stack);
});

exports.app = app;