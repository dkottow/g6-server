var request = require('request');
var validator = require('validator');
var express = require('express');
var bodyParser = require("body-parser");
var jwt = require('jsonwebtoken');

require('dotenv').config();

function Controller() {
	this.router = new express.Router();
	this.initRoutes();
}

function sendError(req, res, err, code) {
	log.error({req: req, code: code, err: err}, 'Controller.sendError()');
	res.status(code).send('Error: ' + err.message);
}

Controller.prototype.initRoutes = function() {
	var me = this;

	var urlencodedParser = bodyParser.urlencoded({ extended: true });

	this.router.post('/signup', urlencodedParser, function(req, res) {
		log.info({req: req}, 'Controller.validateSignup()...');

		if ( ! req.body) {
			sendError(req, res, new Error('No form data'), 400);
			return;
		}

		me.validateSignup(req.body.email, req.body.account, 
            function(err, rsp) {

			if (err) {
				sendError(req, res, err, 400);
				return;
			}
			
			me.doSignup(req.body.email, req.body.account, req.body.password,
            	function(err, rsp) {

				if (err) {
					sendError(req, res, err, 400);
					return;
				}
				
				res.send('ok');
				log.info({res: res}, '...Controller.validateSignup()');
			});
			
		});
	});
}

Controller.prototype.doSignup = function(email, account, pass, cbAfter) {
	var me = this;
	var authRequest = {
		url: 'https://' + process.env.AUTH0_DOMAIN + '/api/v2/users'
		, auth: { 
			bearer: process.env.AUTH0_API_TOKEN 
		}
		, json: true
		, body: { 
			connection: 'DonkeyliftConnection'
			, email: email
			//, username: email
			, password: pass
			, app_metadata: { admin: true, account: account }
		}
	};

	//create user
	request.post(authRequest, function(err, rsp, body) {
		if (err) {
			cbAfter(err, null);
			return;
		}

		if (rsp.statusCode != 201) {
			var err = new Error(rsp.statusMessage);
			cbAfter(err, null);
			return;
		}

		me.getApiToken(function(err, apiToken) {
			if (err) {
				cbAfter(err, null);
				return;
			}

			//create account
			var apiRequest = {
				url: process.env.DONKEYLIFT_API + '/' + account
				, auth: { 
					bearer: apiToken
				}
			};

			request.put(apiRequest, function(err, rsp, body) {
				if (err) {
					cbAfter(err, null);
					return;
				}

				if (rsp.statusCode == 200) {
					cbAfter(null, true);
					return;
				} 

				var err = new Error(rsp.body);
				cbAfter(err, null);
			});
		});
	});
}

Controller.prototype.validateSignup = function(email, account, cbAfter) {
	var me = this;

	if ( ! validator.isEmail(email)) {
		var err = new Error('Username is not a valid email address.');
		cbAfter(err, null);
		return;
	}

	if ( ! /^\w+$/.test(account)) {
		var err = new Error('Account name has invalid caracters. '
                          + 'Only [A-Za-z0-9_] are allowed.');
		cbAfter(err, null);
		return;
	}

	var authRequest = {
		url: 'https://' + process.env.AUTH0_DOMAIN + '/api/v2/users'
		, auth: { 
			bearer: process.env.AUTH0_API_TOKEN 
		}
		, qs: {
			q: 'name: "' + email + '"'
			, search_engine: 'v2'
		}
	};

	//check if user exists
	request.get(authRequest, function(err, rsp, body) {
		if (err) {
			cbAfter(err, null);
			return;
		}

		if (rsp.statusCode != 200) {
			var err = new Error(rsp.statusMessage);
			cbAfter(err, null);
			return;
		}

		var users = JSON.parse(body);
		if (users.length > 0) {
			var err = new Error('User already exists.');
			cbAfter(err, null);
			return;
		}

		me.getApiToken(function(err, apiToken) {
			if (err) {
				cbAfter(err, null);
				return;
			}

			//check if account exists
			var apiRequest = {
				url: process.env.DONKEYLIFT_API + '/' + account
				, auth: { 
					bearer: apiToken
				}
			};

			request.get(apiRequest, function(err, rsp, body) {
				if (err) {
					cbAfter(err, null);
					return;
				}

				if (rsp.statusCode == 200) {
					var err = new Error('Account already exists.');
					cbAfter(err, null);
					return;
				} 

				if (rsp.statusCode == 404) {
					//if account does not exist, signup validation is passed
					cbAfter(null, true);
					return;
				} 

				var err = new Error(rsp.body);
				cbAfter(err, null);
			});
		});
	});
}

Controller.prototype.getApiToken = function(cbAfter) {
	var me = this;	

	var refresh = true;
	if (this.jwtIdToken) {
		var token = jwt.decode(this.jwtIdToken);
		if (token.exp > (Date.now() / 1000)) refresh = false;
	}

	if ( ! refresh) {
		cbAfter(null, this.jwtIdToken);
		return;
	}

	var authRequest = {
		url: 'https://' + process.env.AUTH0_DOMAIN + '/delegation'
		, json: true
		, body: { 
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer'
			, client_id: process.env.AUTH0_CLIENT_ID
			, refresh_token: process.env.AUTH0_REFRESH_TOKEN
			, scope: 'openid email app_metadata'
		}
	}

	request.post(authRequest, function(err, rsp, body) {
		if (err) {
			cbAfter(err, null);
			return;
		}
		
		if (rsp.statusCode != 200) {
			var err = new Error(rsp.statusMessage);
			cbAfter(err, null);
			return;
		}

		me.jwtIdToken = body.id_token;
		cbAfter(null, me.jwtIdToken);
	});
}

exports.SignupController = Controller;
