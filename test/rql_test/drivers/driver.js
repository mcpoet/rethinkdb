var r = require('./../../../drivers/javascript2/build/rethinkdb.js');

var JSPORT = process.argv[2]
var CPPPORT = process.argv[3]

// -- utilities --

function eq_test(one, two) {
    if (one instanceof Array) {

        if (!(two instanceof Array)) return false;
        
        if (one.length != two.length) return false;

        // Recurse on each element of array
        for (var i = 0; i < one.length; i++) {
            if (!eq_test(one[i], two[i])) return false;
        }

        return true;

    } else if (one instanceof Object) {

        if (!(two instanceof Object)) return false;

        // TODO: eq_test({},{foo:4}) will return true
        // Recurse on each property of object
        for (var key in one) {
            if (one.hasOwnProperty(key)) {
                if (!eq_test(one[key], two[key])) return false;
            }
        }
        return true;

    } else {

        // Primitive comparison
        return (typeof one === typeof two) && (one === two)
    }
}

// -- Curried output test functions --

// Equality comparison
function eq(exp) {
    return function(val) {
        if (!eq_test(val, exp)) {
            console.log("Equality comparison failed");
            console.log("Value:", val, "Expected:", exp);
            return false;
        } else {
            return true;
        }
    }
}

// Tests are stored in list until they can be sequentially evaluated
var tests = []

// Any variables defined by the tests are stored here
var defines = {}

// Connect first to cpp server
r.connect({port:CPPPORT}, function(err, cpp_conn) {
	
	// Now connect to js server
	r.connect({port:JSPORT}, function(err, js_conn) {

		// Pull a test off the queue and run it
		function runTest() {
			var testPair = tests.shift();
			if (testPair) {
                var src = testPair[0]
				try {
                    with (defines) {
					    test = eval(src);
                    }
				} catch(err) {
                    console.log("Error "+err.message+" in construction of: "+src)
                    // continue to next test
                    runTest();
                    return;
				}

				var exp_fun = eval(testPair[1]);
                if (!exp_fun)
                    exp_fun = function() { return true; };

                if (!(exp_fun instanceof Function))
                    exp_fun = eq(exp_fun);

				// Run test first on cpp server
				test.run(cpp_conn, function(cpp_err, cpp_res) {
                    
                    // Convert to array if it's a cursor
                    if (cpp_res instanceof Object && cpp_res.toArray) {
                        cpp_res.toArray(afterArray);
                    } else {
                        afterArray(cpp_err, cpp_res);
                    }
					
                    function afterArray(cpp_err, cpp_res) {

                        // Now run test on js server
                        test.run(js_conn, function(js_err, js_res) {

                            if (js_res instanceof Object && js_res.toArray) {
                                js_res.toArray(afterArray2);
                            } else {
                                afterArray2(js_err, js_res);
                            }

                            // Again, convert to array
                            function afterArray2(js_err, js_res) {

                                if (cpp_err) {
                                    console.log("Error when evaluating on CPP server:");
                                    console.log(" "+cpp_err.name+": "+cpp_err.message);
                                } else if (!exp_fun(cpp_res)) {
                                    console.log(" in CPP version of: "+src)
                                }

                                if (js_err) {
                                    console.log("Error when evaluating on JS server:");
                                    console.log(" "+js_err.name+": "+js_err.message);
                                } else if (!exp_fun(js_res)) {
                                    console.log(" in JS version of: "+src)
                                }

                                // Continue to next test. Tests are fully sequential
                                // so you can rely on previous queries results in
                                // subsequent tests.
                                runTest();
                                return;
                            }
                        });
                    }
				});
			} else {
				// We've hit the end of our test list
				// closing the connection will allow the
				// event loop to quit naturally
				cpp_conn.close();
				js_conn.close();
			}
		}

		// Start the recursion though all the tests
		runTest();
	});
});

// Invoked by generated code to add test and expected result
// Really constructs list of tests to be sequentially evaluated
function test(testSrc, resSrc) {
	tests.push([testSrc, resSrc])
}

// Invoked by generated code to define variables to used within
// subsequent tests
function define(expr) {
    eval("defines."+expr);
}

// Invoked by generated code to support bag comparison on this expected value
function bag(list) {
    var bag = eval(list).sort();
    return function(other) {
        other = other.sort();
        return eq_test(bag, other);
    }
}