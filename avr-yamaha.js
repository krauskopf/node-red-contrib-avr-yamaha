/*
The MIT License (MIT)

Copyright (c) 2016 sebakrau

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

module.exports = function(RED) {
  var YamahaAPI = require("yamaha-nodejs");
  var xml2js = require('xml2js');

	/* ---------------------------------------------------------------------------
	 * CONFIG node
	 * -------------------------------------------------------------------------*/
  function AvrYamahaNodeConfig(config) {
    RED.nodes.createNode(this, config);

		// Configuration options passed by Node Red
    this.address = config.address;
		this.name = config.name;

    // Config node state
    this.connected = false;
    this.connecting = false;
    this.closing = false;
    this.subscriptions = {};
    this.inputSocket = undefined;
    this.devDesc = undefined;

    // Define Helper Functions
    var node = this;
    var startEventListener = function() {
      node.log("STARTING event listener");

      var net = require('net');
      var dgram = require('dgram');
      node.inputSocket = dgram.createSocket('udp4');
      node.inputSocket.on('message', function (msg, rinfo) {
        if (rinfo.address == node.address) {
          //node.log("[" + rinfo.address + "] --> " + msg.toString());

          // Split to header and body
          msg = msg.toString().split("\r\n\r\n");
          var header = msg[0];
          var body = msg[1];

          // Ignore UPNP search requests
          var method = header.split("\r\n").shift().split(' ').shift().trim();
          if (method == 'M-SEARCH'){
          	return;
          }

          // Parse rest of header
          var arr = header.match(/[^\r\n]+/g);
      		var headerInfo={};
      		for (var i = 1; i < arr.length; ++i){
            var tem = arr[i].split(/:(.+)?/);
            if (typeof(tem[1])=='string'){tem[1]=tem[1].trim();}
            headerInfo[tem[0].toLowerCase()]=tem[1];
  		    };
          //node.log("METHOD: " + method);
          //node.log("BODY: " + body);
          //node.log("NTS: " + headerInfo['nts']);

          if (method == "NOTIFY" && headerInfo['nts'] == "yamaha:propchange") {
            for (var s in node.subscriptions) {
              node.subscriptions[s].handler("NOTIFY", body);
            }
          }
        }
      });

      node.inputSocket.on('listening', function () {
        //var address = node.inputSocket.address();
        //node.log('UDP client listening on ' + address.address + ":" + address.port);
        node.inputSocket.setBroadcast(true)
        node.inputSocket.setMulticastTTL(128);
        node.inputSocket.addMembership('239.255.255.250');
      });

      node.inputSocket.bind(1900);
    }

    // Define functions called by nodes
    this.users = {};
    this.register = function(mqttNode){
      node.users[mqttNode.id] = mqttNode;
      if (Object.keys(node.users).length === 1) {
          node.connect();
      }
    };

    this.deregister = function(mqttNode,done){
      delete node.users[mqttNode.id];
      if (node.closing) {
        return done();
      }
      if (Object.keys(node.users).length === 0) {
        node.disconnect();
      }
      done();
    };

    this.disconnect = function(done) {
      node.log("STOPING event Listener!");
      if (node.inputSocket) {
        return node.inputSocket.close();
      }
    }

    this.connect = function () {
      if (!node.connected && !node.connecting) {
        node.connecting = true;

        // Try to read the UPNP device description
        var http = require('http');
        var req = http.get({
          host: node.address,
          port: 8080,
          path: '/MediaRenderer/desc.xml'
          },
          function(response) {
            var body = '';
            response.on('data', function(data) {
              body += data;
            });
            response.on('end', function() {

              // Parse device description
              var parseString = require('xml2js').parseString;
              parseString(body, function (err, result) {
                if (err) {
                  node.log("Failed to parse the Device Description with error: " + err);
                  return;
                }
                node.devDesc = {
                  modelName: result.root.device[0].modelName[0],
                  modelNumber: result.root.device[0].modelNumber[0],
                  serialNumber: result.root.device[0].serialNumber[0],
                  modelDescription: result.root.device[0].modelDescription[0],
                  manufacturer: result.root.device[0].manufacturer[0],
                  friendlyName: result.root.device[0].friendlyName[0],
                  presentationURL: result.root.device[0].presentationURL[0],
                  udn: result.root.device[0].UDN[0]
                };
                //node.log("Device Description: " + JSON.stringify(node.devDesc));
              });

              // Update state of all nodes
              node.connecting = false;
              node.connected = true;
              for (var id in node.users) {
                if (node.users.hasOwnProperty(id)) {
                  node.users[id].status({fill:"green", shape:"dot", text:"connected"});
                }
              }

              // Start Multicast listener for event notification
              startEventListener();
            });
        });

        req.on('error', function(err) {
          node.log("Failed to get device description with error: " + err);
          if (node.connecting) {
            node.connecting = false;
          }
        });

      }
    };

    this.subscribe = function(callback, ref) {
      ref = ref || 0;
      var sub = {
        handler:function(topic, payload) {
          callback(topic, payload);
        },
        ref: ref
      };
      node.subscriptions[ref] = sub;
    };

    this.unsubscribe = function(ref) {
      ref = ref || 0;
      var sub = node.subscriptions[ref];
      if (sub) {
        delete node.subscriptions[ref];
      }
    };

    // Define config node event listeners
    node.on("close", function(done){
      node.closing = true;
      node.disconnect();
      done();
    });
  }
  RED.nodes.registerType("avr-yamaha", AvrYamahaNodeConfig);



	/* ---------------------------------------------------------------------------
	 * INPUT node
	 * -------------------------------------------------------------------------*/
  function AvrYamahaNodeIn(config) {
    RED.nodes.createNode(this, config);

		// Save settings in local node
		this.device = config.device;
    this.deviceNode = RED.nodes.getNode(this.device);
		this.name = config.name;
		this.devdesc = config.devdesc;

    // Register at config node to receive new events
    var node = this;
    if (this.deviceNode) {
      this.status({fill:"red", shape:"ring", text:"disconnected"});
      if (this.deviceNode.connected) {
          this.status({fill:"green", shape:"dot", text:"connected"});
      }

      this.deviceNode.register(this);
      this.deviceNode.subscribe(function(topic, payload) {
        var msg = {topic:topic, payload:payload};
        if (node.devdesc) {
          msg.devDesc = node.deviceNode.devDesc;
        }
        node.send(msg);
      }, this.id);

      this.on('close', function(done) {
        if (node.deviceNode) {
          node.deviceNode.unsubscribe(node.id);
          node.deviceNode.deregister(node, done);
          node.yamaha = null;
        }
      });
    } else {
      this.error(RED._("mqtt.errors.missing-config"));
    }
  }
  RED.nodes.registerType("AVR-Yamaha-in", AvrYamahaNodeIn);



	/* ---------------------------------------------------------------------------
	 * GET node
	 * -------------------------------------------------------------------------*/
  function AvrYamahaNodeGet(config) {
    RED.nodes.createNode(this, config);

		// Save settings in local node
		this.device = RED.nodes.getNode(config.device);
		this.name = config.name;
		this.topic = config.topic;
		this.yamaha = new YamahaAPI(this.device.address);
    var node = this;

/*
    if (this.device) {
        this.status({fill:"red",shape:"ring",text:"common.status.disconnected"});

        //node.device.register(this);
        if (this.device.connected) {
            node.status({fill:"green",shape:"dot",text:"common.status.connected"});
        }

        // Node gets closed, tidy up any state
        this.on('close', function(done) {
            if (node.device) {
                //node.device.deregister(node,done);
                node.yamaha = null;
            }
        });
    } else {
      this.error(RED._("mqtt.errors.missing-config"));
    }
    */

		// Input handler, called on incoming flow
    this.on('input', function(msg) {

      // Build command string from topic
      var command = '<YAMAHA_AV cmd="GET">';
      var elements = node.topic.split('.');
      elements.forEach(function(element) { command += '<' + element + '>' });
      command += 'GetParam';
      elements.reverse().forEach(function(element) { command += '</' + element + '>' });
      command += '</YAMAHA_AV>';

      // Request the data using yamaha get
      node.log('sending command:' + command);
      node.yamaha.SendXMLToReceiver(command).then(function(response){
        xml2js.Parser({ explicitArray: false }).parseString(response, function (err, result) {
          if (err) {
            node.log("Failed to parse the response with error: " + err);
            return;
          }

          // Remove reference node path from payload
          var payload = result['YAMAHA_AV'];
          elements.reverse().forEach(function(element) { payload = payload[element]; });

          // Let's flow...
          msg.payload = payload;
          node.send(msg);
        });
      })
      .catch(function(error){
        node.log("Failed to request data from AVR with error: " + error);
      });

      return;
    });
  }
  RED.nodes.registerType("AVR-Yamaha-get", AvrYamahaNodeGet);



	/* ---------------------------------------------------------------------------
	 * PUT node
	 * -------------------------------------------------------------------------*/
	function AvrYamahaNodePut(config) {
		RED.nodes.createNode(this, config);

		// Save settings in local node
		this.device = RED.nodes.getNode(config.device);
		this.name = config.name;
    this.topic = config.topic;
		this.yamaha = new YamahaAPI(this.device.address);
    var node = this;

		// Input handler, called on incoming flow
		this.on('input', function(msg) {
      // TODO
		});

		// Node gets closed, tidy up any state
		this.on('close', function() {
			node.yamaha = null;
		});
	}
	RED.nodes.registerType("AVR-Yamaha-put", AvrYamahaNodePut);



  /* ---------------------------------------------------------------------------
	 * Backend informations
	 * -------------------------------------------------------------------------*/
  require('./references.js').provideReferences(RED);

};
