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

		// Only act as a container here
    var node = this;
    node.address = config.address;
		node.name = config.name;


    node.on("close", function(){
      // Nothing todo, yet...
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

		// Input handler, called on incoming flow
    this.on('input', function(msg) {

			// Check type of request
			switch(node.infotype) {

				case "BasicInfo":
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
					break;

				case "SystemConfig":
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

		// Node gets closed, tidy up any state
    this.on('close', function() {
      node.yamaha = null;
    });
  }
  RED.nodes.registerType("AVR-Yamaha-in", AvrYamahaNodeIn);


};
