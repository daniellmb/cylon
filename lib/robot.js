/*
 * robot
 * cylonjs.com
 *
 * Copyright (c) 2013-2015 The Hybrid Group
 * Licensed under the Apache 2.0 license.
*/

"use strict";

var initConnection = require("./connection"),
    initDevice = require("./device"),
    Logger = require("./logger"),
    Utils = require("./utils"),
    Config = require("./config");

var Async = require("async"),
    EventEmitter = require("events").EventEmitter;

// Public: Creates a new Robot
//
// opts - object containing Robot options
//   name - optional, string name of the robot
//   connection/connections - object connections to connect to
//   device/devices - object devices to connect to
//   work - work to be performed when the Robot is started
//
// Returns a new Robot
// Example (CoffeeScript):
//    Cylon.robot
//      name: "Spherobot!"
//
//      connection:
//        name: "sphero", adaptor: "sphero", port: "/dev/rfcomm0"
//
//      device:
//        name: "sphero", driver: "sphero"
//
//      work: (me) ->
//        Utils.every 1.second(), ->
//          me.sphero.roll 60, Math.floor(Math.random() * 360//
var Robot = module.exports = function Robot(opts) {
  opts = opts || {};

  var methods = [
    "toString",
    "halt",
    "startDevices",
    "startConnections",
    "start",
    "initDevices",
    "initConnections"
  ];

  methods.forEach(function(method) {
    this[method] = this[method].bind(this);
  }, this);

  this.name = opts.name || Robot.randomName();
  this.connections = {};
  this.devices = {};
  this.adaptors = {};
  this.drivers = {};
  this.commands = {};
  this.running = false;
  this.work = opts.work || opts.play;

  if (!this.work) {
    this.work =  function() { Logger.debug("No work yet."); };
  }

  this.initConnections(opts);
  this.initDevices(opts);

  for (var name in opts) {
    var opt = opts[name];

    if (this[name] !== undefined) {
      continue;
    }

    this[name] = opt;

    if (opts.commands == null && typeof(opt) === "function") {
      this.commands[name] = opt;
    }
  }

  if (opts.commands) {
    var cmds = opts.commands;

    if (typeof(opts.commands) === "function") {
      cmds = opts.commands();
    }

    if (typeof(cmds) === "object" && !Array.isArray(cmds)) {
      this.commands = cmds;
    } else {
      var err = "#commands must be an object ";
      err += "or a function that returns an object";
      throw new Error(err);
    }
  }

  var mode = Utils.fetch(Config, "mode", "manual");

  if (mode === "auto") {
    // run on the next tick, to allow for "work" event handlers to be set up
    setTimeout(this.start, 0);
  }
};

Utils.subclass(Robot, EventEmitter);

// Public: Generates a random name for a Robot.
//
// Returns a string name
Robot.randomName = function() {
  return "Robot " + (Math.floor(Math.random() * 100000));
};

// Public: Expresses the Robot in a JSON-serializable format
//
// Returns an Object containing Robot data
Robot.prototype.toJSON = function() {
  var connections = [],
      devices = [];

  for (var conn in this.connections) {
    connections.push(this.connections[conn].toJSON());
  }

  for (var device in this.devices) {
    devices.push(this.devices[device].toJSON());
  }

  return {
    name: this.name,
    connections: connections,
    devices: devices,
    commands: Object.keys(this.commands),
    events: Array.isArray(this.events) ? this.events : []
  };
};

Robot.prototype.connection = function(name, conn) {
  conn.robot = this;
  conn.name = name;

  if (this.connections[conn.name]) {
    var original = conn.name,
        str;

    conn.name = Utils.makeUnique(original, Object.keys(this.connections));

    str = "Connection names must be unique.";
    str += "Renaming '" + original + "' to '" + conn.name + "'";
    Logger.warn(str);
  }

  this.connections[conn.name] = initConnection(conn);

  return this;
};

// Public: Initializes all connections for the robot
//
// opts - options array passed to constructor
//
// Returns initialized connections
Robot.prototype.initConnections = function(opts) {
  var str;

  Logger.info("Initializing connections.");

  if (opts.connection == null && opts.connections == null) {
    return this.connections;
  }

  if (opts.connection) {
    str = "Specifying a single connection with the 'connection' key ";
    str += "is deprecated. It will be removed in 1.0.0.";

    Logger.warn(str);

    this.connection(opts.connection.name, opts.connection);
    return this.connections;
  }

  if (typeof(opts.connections) === "object") {
    if (Array.isArray(opts.connections)) {
      str = "Specifying connections as an array is deprecated. ";
      str += "It will be removed in 1.0.0.";

      Logger.warn(str);

      opts.connections.forEach(function(conn) {
        this.connection(conn.name, conn);
      }, this);

      return this.connections;
    }

    for (var key in opts.connections) {
      var conn = opts.connections[key];

      var name = typeof(key) === "string" ? key : conn.name;

      if (conn.devices) {
        for (var d in conn.devices) {
          var device = conn.devices[d];
          opts.devices = opts.devices || {};
          device.connection = name;
          opts.devices[d] = device;
        }

        delete conn.devices;
      }

      this.connection(name, conn);
    }
  }

  return this.connections;
};

Robot.prototype.device = function(name, device) {
  var str;

  device.robot = this;
  device.name = name;

  if (this.devices[device.name]) {
    var original = device.name;
    device.name = Utils.makeUnique(original, Object.keys(this.devices));

    str = "Device names must be unique.";
    str += "Renaming '" + original + "' to '" + device.name + "'";
    Logger.warn(str);
  }

  if (typeof device.connection === "string") {
    if (this.connections[device.connection] == null) {
      str = "No connection found with the name " + device.connection + ".\n";
      Logger.fatal(str);
      process.emit("SIGINT");
    }

    device.connection = this.connections[device.connection];
  } else {
    for (var conn in this.connections) {
      device.connection = this.connections[conn];
      break;
    }
  }

  this.devices[device.name] = initDevice(device);

  return this;
};

// Public: Initializes all devices for the robot
//
// opts - options array passed to constructor
//
// Returns initialized devices
Robot.prototype.initDevices = function(opts) {
  var str;

  Logger.info("Initializing devices.");

  if (opts.device == null && opts.devices == null) {
    return this.devices;
  }

  // check that there are connections to use
  if (!Object.keys(this.connections).length) {
    throw new Error("No connections specified");
  }

  if (opts.device) {
    str = "Specifying a single device with the 'device' key is deprecated. ";
    str += "It will be removed in 1.0.0.";

    Logger.warn(str);
    this.device(opts.device.name, opts.device);
    return this.devices;
  }

  if (typeof(opts.devices) === "object") {
    if (Array.isArray(opts.devices)) {
      str = "Specifying devices as an array is deprecated. ";
      str += "It will be removed in 1.0.0.";

      Logger.warn(str);

      opts.devices.forEach(function(device) {
        this.device(device.name, device);
      }, this);

      return this.devices;
    }

    for (var key in opts.devices) {
      var device = opts.devices[key];
      this.device(key, device);
    }
  }

  return this.devices;
};

// Public: Starts the Robot working.
//
// Starts the connections, devices, and work.
//
// Returns the result of the work
Robot.prototype.start = function(callback) {
  if (this.running) {
    return this;
  }

  var mode = Utils.fetch(Config, "workMode", "async");

  var start = function() {
    if (mode === "async") {
      this.startWork();
    }
  }.bind(this);

  Async.series([
    this.startConnections,
    this.startDevices,
    start
  ], function(err, results) {
    if (!!err) {
      Logger.fatal("An error occured while trying to start the robot:");
      Logger.fatal(err);

      if (typeof(this.error) === "function") {
        this.error.call(this, err);
      }

      this.emit("error", err);
    }

    if (typeof(callback) === "function") {
      callback(err, results);
    }
  }.bind(this));

  return this;
};

// Public: Starts the Robot"s work and triggers a callback
//
// callback - callback function to be triggered
//
// Returns nothing
Robot.prototype.startWork = function() {
  Logger.info("Working.");

  this.emit("ready", this);
  this.work.call(this, this);
  this.running = true;
};

// Public: Starts the Robot"s connections and triggers a callback
//
// callback - callback function to be triggered
//
// Returns nothing
Robot.prototype.startConnections = function(callback) {
  Logger.info("Starting connections.");

  var starters = [];

  Object.keys(this.connections).forEach(function(name) {
    var conn = this.connections[name];
    this[name] = conn;

    starters.push(function(cb) {
      var str = "Starting connection '" + name + "'";

      if (conn.host) {
        str += " on host " + conn.host;
      } else if (conn.port) {
        str += " on port " + conn.port;
      }

      Logger.debug(str + ".");
      return conn.connect.call(conn, cb);
    });
  }, this);

  return Async.parallel(starters, callback);
};

// Public: Starts the Robot"s devices and triggers a callback
//
// callback - callback function to be triggered
//
// Returns nothing
Robot.prototype.startDevices = function(callback) {
  Logger.info("Starting devices.");

  var starters = [];

  Object.keys(this.devices).forEach(function(name) {
    var device = this.devices[name];
    this[name] = device;

    starters.push(function(cb) {
      var str = "Starting device '" + name + "'";

      if (device.pin) {
        str += " on pin " + device.pin;
      }

      Logger.debug(str + ".");
      return device.start.call(device, cb);
    });
  }, this);

  return Async.parallel(starters, callback);
};

// Public: Halts the Robot.
//
// Halts the devices, disconnects the connections.
//
// callback - callback to be triggered when the Robot is stopped
//
// Returns nothing
Robot.prototype.halt = function(callback) {
  callback = callback || function() {};

  var devices = [],
      connections = [],
      name;

  for (name in this.devices) {
    var device = this.devices[name];
    devices.push(device.halt.bind(device));
  }

  for (name in this.connections) {
    var conn = this.connections[name];
    connections.push(conn.disconnect.bind(conn));
  }

  Async.parallel(devices, function() {
    Async.parallel(connections, callback);
  });

  this.running = false;
};

// Public: Returns basic info about the robot as a String
//
// Returns a String
Robot.prototype.toString = function() {
  return "[Robot name='" + this.name + "']";
};
