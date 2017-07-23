/*
The MIT License (MIT)

Copyright (c) 2017 sebakrau

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
  var deferred = require('deferred');
  var references = require('./references.js');

  function tryParseJSON (jsonString){
      try {
          var o = JSON.parse(jsonString);

          // Handle non-exception-throwing cases:
          // Neither JSON.parse(false) or JSON.parse(1234) throw errors, hence the type-checking,
          // but... JSON.parse(null) returns 'null', and typeof null === "object",
          // so we must check for that, too.
          if (o && typeof o === "object" && o !== null) {
              return o;
          }
      }
      catch (e) { }

      return false;
  };


  /* ---------------------------------------------------------------------------
   * CONFIG node
   * -------------------------------------------------------------------------*/
  function AvrYamahaNodeConfig(config) {
    RED.nodes.createNode(this, config);

    // Configuration options passed by Node Red
    this.address = config.address;
    this.port = config.port;
    this.name = config.name;
    this.debug = config.debug;

    // Config node state
    this.connected = false;
    this.connecting = false;
    this.closing = false;
    this.subscriptions = {};
    this.inputSocket = undefined;
    this.devDesc = undefined;
    this.yamaha = new YamahaAPI(this.address);

    // Define functions called by nodes
    var node = this;

    /**
     * Send a command to the AVR to get a value.
     * @param {string} topic      Contains the name of the reference which should be get.
     * @return                    Returns a promise with the value read.
     */
    this.sendGetCommand = function(topic) {
      var def = deferred();

      // Build command string from topic
      var command = '<YAMAHA_AV cmd="GET">';
      var elements = topic.split('.');
      elements.forEach(function(element) { command += '<' + element + '>' });
      command += 'GetParam';
      elements.reverse().forEach(function(element) { command += '</' + element + '>' });
      command += '</YAMAHA_AV>';

      // Request the data using yamaha get
      if (node.debug) {
        node.log('sending GET command:' + command);
      }
      node.yamaha.SendXMLToReceiver(command).then(function(response) {
        xml2js.Parser({ explicitArray: false }).parseString(response, function (err, result) {
          if (err) {
            def.reject("Failed to parse the response with error: " + err);
            return;
          }

          // Remove reference node path from payload
          var payload = result['YAMAHA_AV'];
          elements.reverse().forEach(function(element) { payload = payload[element]; });

          def.resolve(payload);
        });
      })
      .catch(function(error){
        def.reject(error);
      });

      return def.promise;
    }

    /**
     * Send a command to the AVR to set a value.
     * @param {string} topic      Contains the name of the reference which should be put.
     * @param          payload    The value to be written. Can be a string for primitive refernces of an object for complex ones.
     * @return                    Returns a promise.
     */
    this.sendPutCommand = function(topic, payload) {
      var def = deferred();
      var payloadIsPrimitive = (typeof payload == 'string' || payload instanceof String) ? true : false;

      // Build command string from topic and payload.
      if (payloadIsPrimitive) {
        // Payload is a primitive. Thus. there is only one value to be written in the command string.
        var command = '<YAMAHA_AV cmd="PUT">';
        var elements = topic.split('.');
        elements.forEach(function(element) { command += '<' + element + '>' });
        command += payload.toString().trim();
        elements.reverse().forEach(function(element) { command += '</' + element + '>' });
        command += '</YAMAHA_AV>';
      } else {
        // Payload has additional values which are given as struct. Each one has to be formatted as xml node.
        var command = '<YAMAHA_AV cmd="PUT">';
        var elements = topic.split('.');
        for (var i = 0; i < elements.length - 1; i++) {
          command += '<' + elements[i] + '>';
        }
        for (var element in payload) {
          if (payload.hasOwnProperty(element)) {
            command += '<' + element + '>' + payload[element] + '</' + element + '>';
          }
        }
        for (var i = elements.length - 2; i >= 0; i--) {
          command += '</' + elements[i] + '>';
        }
        command += '</YAMAHA_AV>';
      }

      // Write the data using yamaha put
      if (node.debug) {
        node.log('sending PUT command:' + command);
      }
      node.yamaha.SendXMLToReceiver(command).then(function(response){
        xml2js.Parser({ explicitArray: false }).parseString(response, function (err, result) {
          if (err) {
            def.reject('Failed to parse the response with error: ' + err);
            return;
          }

          // Traverse the response data and check for valid resonse.
          if (payloadIsPrimitive) {
            // payload is primitive
            var payload = result['YAMAHA_AV'];
            elements.reverse().forEach(function(element) {
              if (!payload.hasOwnProperty(element)) {
                node.error('Received unexpected response data: ' + JSON.stringify(result));
              }
              payload = payload[element];
            });

            def.resolve(payload);
          } else {
            // payload is struct
            var payload = result['YAMAHA_AV'];
            for (var i = 0; i < elements.length - 1; i++) {
              if (!payload.hasOwnProperty(elements[i])) {
                node.error('Received unexpected response data: ' + JSON.stringify(result));
              }
              payload = payload[elements[i]];
            }

            def.resolve(payload);
          }
        });
      })
      .catch(function(error){
        def.reject('Failed to write data to AVR with error: ' + error);
      });

      return def.promise;
    }

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
      if (node.debug) {
        node.log("STOPING event Listener!");
      }
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
          port: (!node.port || !node.port.length) ? 8080 : node.port,
          path: '/MediaRenderer/desc.xml'
          },
          function(response) {
            var body = '';
            response.on('data', function(data) {
              body += data;
            });
            response.on('end', function() {

              body = body.replace(/&/g, '&amp;');

              // Parse device description
              var parseString = require('xml2js').parseString;
              parseString(body, function (err, result) {
                if (err) {
                  node.warn("Failed to parse the UPnP Device Description with error: " + err);
                  return;
                }

                try {
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
                }
                catch (err) {
                  node.warn('Failed to decode UPnP Device Description. Error: ' + err);
                  node.warn('This is the parser result which might be wrong: ' + JSON.stringify(result));
                }
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
          node.log('Failed to get device description with error: ' + err);
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


    // Internal sub routines
    var startEventListener = function() {
      if (node.debug) {
        node.log('STARTING event listener');
      }

      var net = require('net');
      var dgram = require('dgram');
      node.inputSocket = dgram.createSocket({type:'udp4', reuseAddr: true});

      node.inputSocket.on('notify', function (event) {
        if (node.debug) {
          node.log('Got a notification.', event)
        }
      });

      node.inputSocket.on('message', function (msg, rinfo) {
        //node.log("[" + rinfo.address + "] --> " + msg.toString());

        if (rinfo.address == node.address) {
          if (node.debug) {
            node.log("UPnP Event from [" + rinfo.address + "] --> " );//+ msg.toString());
          }

          // Split to header and body
          msg = msg.toString().split('\r\n\r\n');
          var header = msg[0];
          var body = msg[1];

          // Ignore UPNP search requests
          var method = header.split('\r\n').shift().split(' ').shift().trim();
          if (method == 'M-SEARCH'){
            return;
          }

          // Parse rest of header
          var arr = header.match(/[^\r\n]+/g);
          var headerInfo = {};
          for (var i = 1; i < arr.length; ++i){
            var tem = arr[i].split(/:(.+)?/);
            if (typeof(tem[1]) == 'string'){ tem[1] = tem[1].trim(); }
            headerInfo[tem[0].toLowerCase()] = tem[1];
          };
          //node.log("METHOD: " + method);
          //node.log("BODY: " + body);
          //node.log("NTS: " + headerInfo['nts']);

          // NOTIFY messages tell us about the properties that changed
          if (method == 'NOTIFY' && headerInfo['nts'] == 'yamaha:propchange') {

            var parseString = require('xml2js').parseString;
            parseString(body, function (err, result) {
              if (err) {
                node.error('Failed to parse the event with error: ' + err);
                return;
              }

              for (var i in result.YAMAHA_AV.Main_Zone[0].Property) {
                var prop = result.YAMAHA_AV.Main_Zone[0].Property[i];
                if (node.debug) {
                  node.log('Property-Change: ' + prop);
                }

                // Event Notification only notifies that there is a change in each item.
                // It is necessary to issue the GET command to obtain the content of the item with the change.
                var topics = {
                  'Power': 'System.Power_Control.Power',
                  'Input': 'Main_Zone.Input.Input_Sel'
                };

                if (topics[prop]) {

                  // There is a list of events which directly map to a single item in the reference nodes.
                  // In case of these events, just read the node and publish to all subscriber nodes in node red.
                  node.sendGetCommand(topics[prop]).then(function(value) {
                    for (var s in node.subscriptions) {
                      node.subscriptions[s].handler(topics[prop], value);
                    }
                  }).catch(function(error) {
                    node.error('Failed to request data from AVR with error: ' + error);
                  });

                } else if (prop == 'Volume') {

                  // We don't know from the event itself if volume changed or mute/unmute was pressed.
                  // Therefore we read both states.
                  node.sendGetCommand('Main_Zone.Volume.Lvl').then(function(value) {
                    for (var s in node.subscriptions) {
                      node.subscriptions[s].handler('Main_Zone.Volume.Lvl', value);
                    }
                  }).catch(function(error) {
                    node.error('Failed to request data from AVR with error: ' + error);
                  });
                  node.sendGetCommand('Main_Zone.Volume.Mute').then(function(value) {
                    for (var s in node.subscriptions) {
                      node.subscriptions[s].handler('Main_Zone.Volume.Mute', value);
                    }
                  }).catch(function(error) {
                    node.error('Failed to request data from AVR with error: ' + error);
                  });

                } else if (prop == 'Play_Info') {

                  // When getting the Play_Info event we need to check the current input mode and then read
                  // the corresponding item that holds info about current mode.
                  node.sendGetCommand('Main_Zone.Input.Input_Sel').then(function(value) {
                    var validInputs = [
                      'Tuner', 'Napster', 'Spotify', 'JUKE', 'SERVER', 'NET_RADIO', 'USB', 'iPod_USB', 'AirPlay'
                    ];
                    if (validInputs.indexOf(value) > -1) {
                      node.sendGetCommand(value + '.Play_Info').then(function(value2) {
                        for (var s in node.subscriptions) {
                          node.subscriptions[s].handler(value + '.Play_Info', value2);
                        }
                      }).catch(function(error) {
                        node.error('Received event Play_Info but failed to read play info of current input selection: ' + error);
                      });
                    } else {
                      if (node.debug) {
                        node.log('Received event Play_Info but do not know or support current input selection ' + value);
                      }
                    }
                  }).catch(function(error) {
                    node.error('Received event Play_Info but failed to read current input selection: ' + error);
                  });

                } else if (prop == 'List_info') {

                  // When getting the List_info event we need to check the current input mode and then read
                  // the corresponding item that holds info about current mode.
                  node.sendGetCommand('Main_Zone.Input.Input_Sel').then(function(value) {
                    var validInputs = [
                      'Napster', 'JUKE', 'SERVER', 'NET_RADIO', 'USB', 'iPod_USB'
                    ];
                    if (validInputs.indexOf(value) > -1) {
                      node.sendGetCommand(value + '.List_Info').then(function(value2) {
                        for (var s in node.subscriptions) {
                          node.subscriptions[s].handler(value + '.List_Info', value2);
                        }
                      }).catch(function(error) {
                        node.error('Received event List_Info but failed to read play info of current input selection: ' + error);
                      });
                    } else {
                      if (node.debug) {
                        node.log('Received event List_Info but do not know or support current input selection ' + value);
                      }
                    }
                  }).catch(function(error) {
                    node.error('Received event List_Info but failed to read current input selection: ' + error);
                  });

                } else {

                  // The event is not known. Maybe the AVR is too new.
                  if (node.debug) {
                    node.log('Received unsupported Property-Change via multicast: ' + prop);
                  }
                  return;

                }
              }
            });
          }
        }
      });

      node.inputSocket.on('listening', function () {
        try {
          var address = node.inputSocket.address();
          node.log('UDP client listening on ' + address.address + ":" + address.port);
          node.inputSocket.setBroadcast(true)
          node.inputSocket.setMulticastTTL(5);
          node.inputSocket.addMembership('239.255.255.250');
          //node.inputSocket.addMembership('239.255.255.250', '192.168.0.101');
          //node.inputSocket.addMembership('239.255.255.250', '127.0.0.1');

          /*
          var message = new Buffer(
            "M-SEARCH * HTTP/1.1\r\n" +
            "HOST: 239.255.255.250:1900\r\n" +
            "MAN: \"ssdp:discover\"\r\n" +
            "ST: ssdp:all\r\n" + // Essential, used by the client to specify what they want to discover, eg 'ST:ge:fridge'
            "MX: 3\r\n" + // 1 second to respond (but they all respond immediately?)
            "\r\n");
          */

            //node.inputSocket.send(message, 0, message.length, 1900, "239.255.255.250");
          } catch (err) {
            node.warn('Cannot bind address for UPNP event listener. Port probably already in use. Error: ' + err);
          }
        });

      try {
        node.inputSocket.bind(1900);
      }
      catch (err) {
        node.warn('Cannot bind address for UPNP event listener. Port probably already in use. Error: ' + err);
      }
    }

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
      this.error(RED._("avr-yamaha.errors.missing-config"));
    }
  }
  RED.nodes.registerType("AVR-Yamaha-in", AvrYamahaNodeIn);



  /* ---------------------------------------------------------------------------
   * GET node
   * -------------------------------------------------------------------------*/
  function AvrYamahaNodeGet(config) {
    RED.nodes.createNode(this, config);

    // Save settings in local node
    this.device = config.device;
    this.deviceNode = RED.nodes.getNode(this.device);
    this.name = config.name;
    this.topic = config.topic;

    var node = this;
    if (this.deviceNode) {

  		// Input handler, called on incoming flow
      this.on('input', function(msg) {

        // If no topic is given in the config, then we use the topic in the msg.
        var topic = (node.topic) ? node.topic : msg.topic;
        if (!topic) {
          node.error('No topic given. Specify either in the config or via msg.topic!');
          return;
        }

        // Get data from the device.
        node.deviceNode.sendGetCommand(topic).then(function(value) {
          msg.payload = value;
          node.send(msg);
        }).catch(function(error) {
          node.error("Failed to request data from AVR with error: " + error);
        });

      });

    } else {
      this.error(RED._("avr-yamaha.errors.missing-config"));
    }
  }
  RED.nodes.registerType("AVR-Yamaha-get", AvrYamahaNodeGet);



  /* ---------------------------------------------------------------------------
   * PUT node
   * -------------------------------------------------------------------------*/
  function AvrYamahaNodePut(config) {
    RED.nodes.createNode(this, config);

    // Save settings in local node
    this.device = config.device;
    this.deviceNode = RED.nodes.getNode(this.device);
    this.name = config.name;
    this.topic = config.topic;
    this.payload = config.payload;

    var node = this;
    if (this.deviceNode) {

  		// Input handler, called on incoming flow
  		this.on('input', function(msg) {

        // If no topic is given in the config, then we us the topic in the msg.
        var topic = (node.topic) ? node.topic : msg.topic;
        if (!topic) {
          node.error('No topic given. Specify either in the config or via msg.topic!');
          return;
        }

        // If no payload is given in the config, then we us the payload in the msg.
        var payload = (node.payload) ? node.payload : msg.payload;
        if (payload === null || payload === undefined) {
          node.error('invalid payload: ' + payload.toString());
          return;
        }

        // Some commands need additional payload values. These might be given as JSON object or
        // automatically added.
        var jsonPayload = tryParseJSON(payload);
        if (jsonPayload !== false) {
          payload = jsonPayload
        } else {
          // Check if this topic needs additional payload values and add them to payload
          var addPayloadFormat = references.hasAdditionalPayload(topic);
          if (addPayloadFormat) {
            payload = JSON.parse(addPayloadFormat.replace('%s', payload).trim());
          }
        }

        // Put data to the device.
        node.deviceNode.sendPutCommand(topic, payload).then(function(value) {
          // Continue the flow when data has been put...
          node.send(msg);
        }).catch(function(error) {
          node.error("Failed to put data to AVR with error: " + error);
        });

  		});

    } else {
      this.error(RED._("avr-yamaha.errors.missing-config"));
    }
  }
  RED.nodes.registerType("AVR-Yamaha-put", AvrYamahaNodePut);



  /* ---------------------------------------------------------------------------
   * Backend informations
   * -------------------------------------------------------------------------*/
   references.provideReferences(RED)

};
