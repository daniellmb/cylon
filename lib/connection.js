/*
 * connection
 * cylonjs.com
 *
 * Copyright (c) 2013-2015 The Hybrid Group
 * Licensed under the Apache 2.0 license.
*/

"use strict";

var Registry = require("./registry"),
    Config = require("./config");

var testMode = function() {
  return process.env.NODE_ENV === "test" && Config.testMode;
};

// Public: Creates a new Adaptor and returns it.
//
// opts - hash of acceptable params:
//   robot - Robot the Connection belongs to
//   name - name for the connection
//   adaptor - string module name of the adaptor to be set up
//   port - string port to use for the Connection
//
// Returns the newly set-up connection
module.exports = function Connection(opts) {
  var module, name, prop;

  opts = opts || {};

  if (opts.module) {
    module = Registry.register(opts.module);
  } else {
    module = Registry.findByAdaptor(opts.adaptor);
  }

  if (!module) {
    Registry.register("cylon-" + opts.adaptor);
    module = Registry.findByAdaptor(opts.adaptor);
  }

  var adaptor = module.adaptor(opts);

  for (name in adaptor) {
    prop = adaptor[name];

    if (name === "constructor") {
      continue;
    }

    if (typeof(prop) === "function") {
      adaptor[name] = prop.bind(adaptor);
    }
  }

  if (testMode()) {
    var testAdaptor = Registry.findByAdaptor("test").adaptor(opts);

    for (name in adaptor) {
      prop = adaptor[name];

      if (typeof(prop) === "function" && !testAdaptor[name]) {
        testAdaptor[name] = function() { return true; };
      }
    }

    return testAdaptor;
  }

  return adaptor;
};
