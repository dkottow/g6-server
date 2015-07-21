/*
	mocha tests - run me from parent dir
*/
var assert = require('assert')
	, _ = require('underscore')
	, util = require('util')
	, sqlite3 = require('sqlite3').verbose()
	, Database = require('../app/Database').Database;
	
var isDescendant = require('../app/Database').isDescendant;


describe('Model', function() {
	var dbFile = "test/test-model.sqlite";
	var model = new Database(dbFile);

	before(function(done) {
		model.init(done);
	});	

	after(function(done) {
		//console.log("DELETING ALL ROWS id > 2");
		var db = new sqlite3.Database(dbFile);
		db.run("DELETE FROM orders WHERE id > 10", done);
		//db.run("DELETE FROM fts_orders WHERE docid > 10", done);
		db.close();
	});

	describe('init()', function() {
		it('guards file not found', function(done) {
			var m = new Database("file-not-found.sqlite");
			m.init(function(err) {
				assert(err instanceof Error);
				done();	
			});
		});
	});
	
  	describe('getSchema()', function() {		

		var defs;
		
		before(function(done) {
			model.getSchema(function(err, result) {
				defs = result;
				//console.log(defs);
				done();
			});
			//console.log(defs);
		});

		it('sales.sqlite has 4 tables', function() {
			//console.log(_.values(defs.tables));
			assert.equal(_.values(defs.tables).length, 4);
		});

		it('sales.sqlite has products table with some fields', function() {
			var products = defs.tables["products"];
			assert(products, 'table exists');
			assert(_.values(products.fields).length > 3, 'fields exists');
			assert.equal(products.children.length, 1, 'one child');
		});

	});

  	describe('isDescendant()', function() {		
		it('products_in_orders descendant from products', function() {
			var d = model.tables().products_in_orders;
			var t = model.tables().products;
			var result = isDescendant(d, t, 5);
			//console.log("Descendant " + d.name + " from " + t.name + " is " + result);	
			assert(result, d.name + " descends from " + t.name);
		});
	});

  	describe('getStats()', function() {		
		it('getStats from orders', function(done) {
			model.getStats(model.tables().orders, function(err, result) {
				console.log(result);
				done();
			});
		});
	});

  	describe('all()', function() {		

		it('get all customers/products', function(done) {
			var tables = [model.tables().products, model.tables().customers];

			var allDone = _.after(tables.length, done);			

			_.each(tables, function(t) {
				var order = [{'name': 'asc'}];
				model.all(t, [], '*', order, 1000, function(err, result) {
					assert(err == null, err);
					console.log('got ' + result.rows.length + " of " + result.count + " " + t.name);
					assert(result.count > 0, 'got some ' + t.name);
					allDone();
				});
			});

		});

		it('all orders filtered by customer and limited amount', function(done) {

			var table = model.tables().orders;

			var filters = [
				{'table': 'customers', 'field': 'name', 'operator': 'eq', 'value': 'Daniel'},
				{'field': 'total_amount', 'operator': 'le', 'value': 100},
			];
			model.all(table, filters, '*', [], 10, function(err, result) {
				assert(err == null, err);
				console.log('got ' + result.count + " " + table.name);
				assert(result.count > 0, 'got some ' + table.name);
				done();
			});

		});

		it('all products ordered filtered by customer', function(done) {

			var table = model.tables().products;

			var filters = [
				{'table': 'customers', 'field': 'name', 'operator': 'eq', 'value': 'Daniel'}
			];
			model.all(table, filters, '*', [], 10, function(err, result) {
				assert(err == null, err);
				console.log('got ' + result.count + " " + table.name);
				assert(result.count > 0, 'got some ' + table.name);
				done();
			});

		});
	});

  	describe('getDeep()', function() {		
		it('get customer deep', function(done) {
			model.getDeep(model.tables().customers, 
						  	[{'field' : 'id', 'operator': 'eq', 'value' : 1}],
						  	'*', 2,
							function(err, result) {
								assert(err == null, 'getDeep failed ' + err)
/*
		console.log("******* done deep... *******")
		console.log(util.inspect(result, {depth: 5}));				
		console.log("******* ...done deep *******")
*/
				done();
			});
		});
	});

  	describe('insert()', function() {		

		var table;
		before(function() {
			table = model.tables().orders;
		});	

		it('100 rows', function(done) {

			this.timeout(10000); //10secs

			var rows = [];
			var row = {
				'order_date': '2015-01-01', 
				'customer_id': 1,
				'total_amount': 10.50,
				'modified_by': 'mocha', 
				'modified_on': '2000-01-01' 
			};

			for(var i = 1;i < 100; ++i) {
				var r = _.clone(row);
				r.customer_id = _.sample([1,2]);
				r.total_amount = Math.round(1000*Math.random(), 2);
				rows.push(r);
			}

			model.insert(table, rows, function(err, result) { 
				assert(err == null, err);
				done(); 
			});
		});

/* TODO not-nullable
		it('fail on 2nd row', function(done) {
			var rows = [
				{
					'order_date': '2015-01-01', 
					'customer_id': 1,
					'total_amount': 10.50,
					'modified_by': 'mocha', 
					'modified_by': '2000-01-01' 
				},
				{
					'order_date': '2015-01-01', 
					'customer_id': 2,
					'total_amount': 9.50,
					'modified_on': '2000-01-01' 
				}
			];				
			model.insert(table, rows, function(err, result) { 
				console.log(err);
				console.log(result);
				assert(err instanceof Error, 'sqlite null constraint holds on 2nd row');
				done();
			});
		});
*/ 

		it('field type mismatch (date)', function(done) {
			var row = {
				'order_date': 'foo', 
				'customer_id': 1,
				'total_amount': 10.50,
				'modified_by': 'mocha', 
				'modified_on': '2000-01-01' 
			};
			model.insert(table, [row], function(err, result) { 
				console.log(err);
				assert(err instanceof Error, 'sqlite check constraint holds');
				done();
			});
		});
	});

  	describe('update()', function() {		

		var table;
		before(function() {
			table = model.tables().orders;
		});	

		it('some rows', function(done) {

			var rows = [];
			var row = {
				'id': 0,
				'order_date': '2015-01-02', 
				'customer_id': 1,
				'total_amount': 2.00,
				'modified_by': 'mocha', 
				'modified_on': '2001-01-01' 
			};

			for(var i = 5; i < 20; ++i) {
				var r = _.clone(row);
				r.id = i;
				r.total_amount = i*10 + 0.5;
				rows.push(r);
			}

			model.update(table, rows, function(err, result) { 
				assert(err == null, 'update some rows');
				done(); 
			});
		});

		it('row does not exist', function(done) {

			var row = {
				'id': 666,
				'order_date': '2015-01-02', 
				'customer_id': 1,
				'total_amount': 2.00,
				'modified_by': 'mocha', 
				'modified_on': '2001-01-01' 
			};

			model.update(table, [row], function(err, result) { 
				console.log(err);
				assert(err instanceof Error, 'row does not exist');
				done(); 
			});
		});

		it('field type mismatch (numeric)', function(done) {

			var row = {
				'id': 666,
				'order_date': '2015-01-02', 
				'customer_id': 1,
				'total_amount': 'foo',
				'modified_by': 'mocha', 
				'modified_on': '2001-01-01' 
			};

			model.update(table, [row], function(err, result) { 
				console.log(err);
				assert(err instanceof Error, 'update did not fail');
				done(); 
			});
		});


		it('unknown foreign key', function(done) {

			var row = {
				'id': 5,
				'order_date': '2015-01-02', 
				'customer_id': 666,
				'total_amount': 2.00,
				'modified_by': 'mocha', 
				'modified_on': '2001-01-01' 
			};

			model.update(table, [row], function(err, result) { 
				console.log(err);
				assert(err instanceof Error, 'update did not fail');
				done(); 
			});
		});
	});

  	describe('delete()', function() {		

		var table;
		before(function() {
			table = model.tables().orders;
		});	

		it('delete some rows', function(done) {

			model.delete(table, [11, 12, 15], function(err, result) {
				assert(err == null, 'deleted some rows');
				done(); 
			});
		});
	});

/*
  	describe('all() and get()', function() {		

		it('all root tables', function(done) {
			var roots = _.filter(model.tables, function(t) {
				return t.parent == null;
			});

			var allDone = _.after(roots.length, done);			

			_.each(roots, function(t) {
				model.all(t, {}, '', '*', {}, "", function(err, result) {
					assert(result.length > 0, 'got some ' + t.name);
					allDone();
				});
			});

		});

		it('list rows of first child table belonging to borehole Pit001', function(done) {


			var child = _.find(model.tables, function(t) {
				return _.contains(t.parents, function(pt) {
					pt.name == 'borehole';
				});
			});

			model.get(child.parent, {'field': 'id', 'op': 'lesser', 'value': 100}, '', ['borehole.id', 'borehole."user"'], function(err, result) {
				model.all(child, {'borehole.id': result.id}, '*', {}, "", function(err, result) {
					assert(result.length > 10, 'got more than 10 ' + child.name);
					assert(result[10].from > 20, child.name + ' #10 is deeper than 20 mts');
					done();
				});
			});
		});

		it('list rows of fracture table belonging to borehole 1', function(done) {
			var table = _.find(model.tables, function(t) {
				return t['name'] == 'fracture';
			});
			
			model.all(table, {'borehole.id' : 1}, '*', {'distance': 'asc'}, '5, 100', function(err, result) {
				assert(result.length > 10, 'got more than 10 fractures');
				done();
			});
		});

		it('list rows of fracture table belonging to rock 1', function(done) {
			var table = _.find(model.tables, function(t) {
				return t['name'] == 'fracture';
			});
			
			model.all(table, {'rock.id' : 1}, '*', {}, "", function(err, result) {
				assert(1 <= result.length && result.length < 10, 'got between 1 and 10 fractures');
				done();
			});
		});

		it('list rows of ground_soil table belonging to borehole 2', function(done) {
			var table = _.find(model.tables, function(t) {
				return t['name'] == 'ground_soil';
			});
			
			model.all(table, {'borehole.id' : 2}, '*', {}, 100, function(err, result) {
				assert(result.length > 5, 'got more than 5 soils');
				done();
			});
		});
	});
*/


});

