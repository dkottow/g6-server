var graphlib = require('graphlib');
var _ = require('underscore');
var util = require('util');

var graphutil = require('./graph_util.js');

var nodeIsTable = function(node) {
	return node.indexOf('.') < 0;
}

var getTableJoins = function(spanningTree, tables) {
	//console.log('getTableJoins ' + tables);
	//console.log('tree ' + spanningTree.isDirected());
	var result = {};

	var paths = graphlib.alg.dijkstra(spanningTree, tables[0], 
				function(e) { return 1; },
				function(v) { return spanningTree.nodeEdges(v); } 
	);
	//console.log(paths);

	for(var i = 1; i < tables.length; ++i) {

		var j1 = tables[i];
//console.log('try pred of ' + j1);
		var fk = paths[j1].predecessor;
		var j2 = paths[fk].predecessor;
		result[fk] = [j1, j2];

		while(j2 != tables[0]) {
			j1 = j2;
			fk = paths[j1].predecessor;
			j2 = paths[fk].predecessor;
			result[fk] = [j1, j2];
		}
	}

	//console.log(result);
	return result;
}

var TableGraph = function(tables) {
	var me = this;

	me.graph = new graphlib.Graph({ directed: true });

	me.tables = function() {
		return _.filter(me.graph.nodes(), function(node) {
			return nodeIsTable(node);
		});
	}

	me.tableJoins = function(tables) {
		var joins = _.map(me.trees, function(tree) { 
			return getTableJoins(tree, tables); 
		});
		var hashFn = function(join) { return _.keys(join).sort().join(' '); }
		var distinctJoins = {};
		
		_.each(joins, function(join) {
			distinctJoins[hashFn(join)] = join;
		});
		return _.values(distinctJoins);
	}

	function init(tables) {	

		_.each(tables, function(table) {
			me.graph.setNode(table.name, table);					
		});

		_.each(tables, function(table) {
			var fks = _.filter(table.fields, function(f) {
				return f.fk == 1;
			});

			_.each(fks, function(fk) {			
				var fkFullName = table.name + "." + fk.name;
				console.log('fk ' + fkFullName);
				me.graph.setNode(fkFullName);
				me.graph.setEdge(fkFullName, fk.fk_table);
				me.graph.setEdge(table.name, fkFullName);
			});

		});

		buildAllTrees();
	}

	function buildAllTrees() { 

		me.trees = [];

		var weightFn = function(e) {
			/*
			console.log('weight ' + e.v + ' ' + e.w +  ' = ' + 
				me.graph.inEdges(e.w).length);
			*/
			return me.graph.inEdges(e.w).length;
		}

		var mst = graphlib.alg.prim(me.graph, weightFn);
		var tree = graphutil.DirectTreeEdgesAsGraph(mst, me.graph);
		me.trees.push(tree);

		var graph = graphlib.json.read(graphlib.json.write(me.graph));

		var cycle = graphutil.FindCycle(graph).cycle;
		while(cycle.length > 0) {
			//console.log(graph.edges());
			//remove 1st edge from cycle found
			console.log('found cycle ' + cycle);
			var e = { v: cycle[0], w: cycle[1] };
			if ( ! graph.hasEdge(e)) {
				e = { v: cycle[1], w: cycle[0] };
			}
			console.log('removing edge')
			console.log(e);
			graph.removeEdge(e);

			mst = graphlib.alg.prim(graph, weightFn);
			tree = graphutil.DirectTreeEdgesAsGraph(mst, graph);
			me.trees.push(tree);

			cycle = graphutil.FindCycle(graph).cycle;
		}
	}

	init(tables);
}

TableGraph.prototype.tableJSON = function(table) {
	table = _.isObject(table) ? table.name : table;
	var json = this.graph.node(table).toJSON();
	json.parents = this.graph.successors(table);
	json.children = this.graph.predecessors(table);
	return json;
}

exports.TableGraph = TableGraph;
