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

    // Define functions called by get and put nodes
    var node = this;
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
            if (node.client) {
                return node.client.end(done);
            }
        }
        done();
    };

    this.connect = function () {
      if (!node.connected && !node.connecting) {
        node.connecting = true;

        // Try to read the UPNP device description
        node.log("Try to get device description");

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
              node.log("Received Device Description: ");

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
                node.log("Device Description: " + JSON.stringify(node.devDesc));
              });

              // Update state of all nodes
              node.connecting = false;
              node.connected = true;
              for (var id in node.users) {
                if (node.users.hasOwnProperty(id)) {
                  node.users[id].status({fill:"green",shape:"dot",text:"common.status.connected"});
                }
              }
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

    /*
    node.log("starting listener");

    var net = require('net');
    var dgram = require('dgram');

    var inputSocket = dgram.createSocket('udp4');
    inputSocket.on('message', function (msg, rinfo) {
      if (rinfo.address == node.address) {
        node.log("[" + rinfo.address + "] --> " + msg.toString().replace(/(\r\n|\n|\r)/gm,""));
      }
    });

    inputSocket.on('listening', function () {
        var address = inputSocket.address();
        node.log('UDP Client listening on ' + address.address + ":" + address.port);
        inputSocket.setBroadcast(true)
        inputSocket.setMulticastTTL(128);
        inputSocket.addMembership('239.255.255.250'); //, '192.168.0.101');
    });

    inputSocket.bind(1900); //, '192.168.0.255', function () {
    */

    node.on("close", function(){
      this.closing = true;
      if (this.connected) {
          this.client.once('close', function() {
              done();
          });
          this.client.end();
      } else {
          done();
      }
    });
  }
  RED.nodes.registerType("avr-yamaha", AvrYamahaNodeConfig);



	/* ---------------------------------------------------------------------------
	 * INPUT node
	 * -------------------------------------------------------------------------*/
  function AvrYamahaNodeIn(config) {
    RED.nodes.createNode(this, config);

		// Save settings in local node
    var node = this;
		node.device = RED.nodes.getNode(config.device);
		node.name = config.name;
		node.infotype = config.infotype;
		node.yamaha = new YamahaAPI(node.device.address);


    if (this.device) {

        this.status({fill:"red",shape:"ring",text:"common.status.disconnected"});

        node.device.register(this);
/*
        this.brokerConn.subscribe(this.topic,2,function(topic,payload,packet) {
            if (isUtf8(payload)) { payload = payload.toString(); }
            var msg = {topic:topic,payload:payload, qos: packet.qos, retain: packet.retain};
            if ((node.brokerConn.broker === "localhost")||(node.brokerConn.broker === "127.0.0.1")) {
                msg._topic = topic;
            }
            node.send(msg);
        }, this.id);
        */
        if (this.device.connected) {
            node.status({fill:"green",shape:"dot",text:"common.status.connected"});
        }


        // Node gets closed, tidy up any state
        this.on('close', function(done) {
            if (node.device) {
                //node.brokerConn.unsubscribe(node.topic,node.id);
                node.device.deregister(node,done);
                node.yamaha = null;
            }
        });


    } else {
        //this.error(RED._("mqtt.errors.missing-config"));
    }







		// Input handler, called on incoming flow
    this.on('input', function(msg) {

			// Check type of request
			switch(node.infotype) {

				case "BasicStatus":
          //var command = '<YAMAHA_AV cmd="GET"><Main_Zone><Basic_Status>GetParam</Basic_Status></Main_Zone></YAMAHA_AV>';
/*
          var command = '<YAMAHA_AV cmd="PUT"><System><Misc><Event><Notice>On</Notice></Event></Misc></System></YAMAHA_AV>';

          node.yamaha.SendXMLToReceiver(command).then(function(result){
            node.log("got result " + result);
          })
          .catch(function(error){
            node.log("got error " + error);
          });
          */

          var command = '<YAMAHA_AV cmd="GET"><System><Misc><Event><Notice>GetParam</Notice></Event></Misc></System></YAMAHA_AV>';

          node.yamaha.SendXMLToReceiver(command).then(function(result){
            node.log("got result " + result);
          })
          .catch(function(error){
            node.log("got error " + error);
          });
          /*
					node.yamaha.getBasicInfo().done(function(basicInfo) {
						msg.payload = {
							'volume' : basicInfo.getVolume(),
							'currentInput' : basicInfo.getCurrentInput(),
							'isOn' : basicInfo.isOn(),
							'isMuted' : basicInfo.isMuted(),
							'isPureDirectEnabled' :  basicInfo.isPureDirectEnabled()
						};
						node.send(msg);
					});
          */
					break;

				case "DeviceInfo":
					node.yamaha.getSystemConfig().done(function(data) {
						msg.payload = data;
						node.send(msg);
					});
					break;

				case "WebRadioChannels":
					node.yamaha.getWebRadioChannels().done(function(data) {
						msg.payload = data;
						node.send(msg);
					});
					break;

				case "AvailableInputs":
					node.yamaha.getAvailableInputs().done(function(data) {
						msg.payload = data;
						node.send(msg);
					});
					break;

				default:
					node.error("Unknown info type: " + node.infotype);
			}

    });


  }
  RED.nodes.registerType("AVR-Yamaha-in", AvrYamahaNodeIn);


	/* ---------------------------------------------------------------------------
	 * OUTPUT node
	 * -------------------------------------------------------------------------*/
	function AvrYamahaNodeOut(config) {
		RED.nodes.createNode(this, config);

		// Save settings in local node
		var node = this;
		node.device = RED.nodes.getNode(config.device);
		node.name = config.name;

		node.yamaha = new YamahaAPI(node.device.address);

		// Input handler, called on incoming flow
		this.on('input', function(msg) {


		});

		// Node gets closed, tidy up any state
		this.on('close', function() {
			node.yamaha = null;
		});
	}
	RED.nodes.registerType("AVR-Yamaha-out", AvrYamahaNodeOut);

};
