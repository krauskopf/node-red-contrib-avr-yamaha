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
		this.infotype = config.infotype;
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

      // Build command string from infotype
      var command = '<YAMAHA_AV cmd="GET">';
      var elements = node.infotype.split('.');
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

  // This is the list of supported 'reference nodes' as described by the
  // Yamaha YNC API documentation. Currently this is the list as supported
  // by the RX-V677.
  var referencesGet = [
    'System.Config',
    'System.Power_Control.Power',
    'System.Power_Control.ECO_Mode',
    'System.Power_Control.Auto_Power_Standby.Timer',
    'System.Sound_Video.Dynamic_Range',
    'System.Sound_Video.HDMI.Control',
    'System.Sound_Video.HDMI.Output.OUT_1',
    'System.Sound_Video.HDMI.Audio.Main_Zone_Output',
    'System.Sound_Video.HDMI.Audio.TV_Audio_In',
    'System.Sound_Video.HDMI.Audio.Audio_Return_Channel',
    'System.Sound_Video.HDMI.Standby_Sync',
    'System.Sound_Video.HDMI.Standby_Through',
    'System.Sound_Video.HDMI.Video.Mode',
    'System.Sound_Video.HDMI.Video.Aspect',
    'System.Sound_Video.HDMI.Video.Resolution',
    'System.Sound_Video.Lipsync.Mode',
    'System.Sound_Video.Lipsync.Current',
    'System.Sound_Video.Lipsync.Manual',
    'System.Sound_Video.Lipsync.Offset_for_Auto',
    'System.Sound_Video.Lipsync.Input_Enable',
    'System.Input_Output.Assign.Video_Out',
    'System.Input_Output.Assign.Audio_In',
    'System.Input_Output.Volume_Trim',
    'System.Input_Output.Input_Name',
    'System.Input_Output.Input_Icon',
    'System.Speaker_Preout.Pattern_1.Power_Amp_Assign',
    'System.Speaker_Preout.Pattern_1.Config.Front',
    'System.Speaker_Preout.Pattern_1.Config.Center',
    'System.Speaker_Preout.Pattern_1.Config.Sur',
    'System.Speaker_Preout.Pattern_1.Config.Sur_Back',
    'System.Speaker_Preout.Pattern_1.Config.Front_Presence',
    'System.Speaker_Preout.Pattern_1.Config.Subwoofer',
    'System.Speaker_Preout.Pattern_1.Config.Layout',
    'System.Speaker_Preout.Pattern_1.Distance',
    'System.Speaker_Preout.Pattern_1.Lvl',
    'System.Speaker_Preout.Pattern_1.PEQ.Sel',
    'System.Speaker_Preout.Pattern_1.PEQ.Manual_Data.Front_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Manual_Data.Front_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Manual_Data.Center',
    'System.Speaker_Preout.Pattern_1.PEQ.Manual_Data.Sur_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Manual_Data.Sur_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Manual_Data.Sur_Back_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Manual_Data.Sur_Back_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Manual_Data.Front_Presence_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Manual_Data.Front_Presence_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Flat_Data.Front_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Flat_Data.Front_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Flat_Data.Center',
    'System.Speaker_Preout.Pattern_1.PEQ.Flat_Data.Sur_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Flat_Data.Sur_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Flat_Data.Sur_Back_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Flat_Data.Sur_Back_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Flat_Data.Front_Presence_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Flat_Data.Front_Presence_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Front_Data.Front_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Front_Data.Front_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Front_Data.Center',
    'System.Speaker_Preout.Pattern_1.PEQ.Front_Data.Sur_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Front_Data.Sur_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Front_Data.Sur_Back_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Front_Data.Sur_Back_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Front_Data.Front_Presence_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Front_Data.Front_Presence_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Natural_Data.Front_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Natural_Data.Front_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Natural_Data.Center',
    'System.Speaker_Preout.Pattern_1.PEQ.Natural_Data.Sur_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Natural_Data.Sur_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Natural_Data.Sur_Back_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Natural_Data.Sur_Back_R',
    'System.Speaker_Preout.Pattern_1.PEQ.Natural_Data.Front_Presence_L',
    'System.Speaker_Preout.Pattern_1.PEQ.Natural_Data.Front_Presence_R',
    'System.Misc.Display.Language',
    'System.Misc.Display.Wall_Paper',
    'System.Misc.Display.FL',
    'System.Misc.Display.Short_Message',
    'System.Misc.Network.Network_Standby',
    'System.Misc.Network.Parameters',
    'System.Misc.Network.Info',
    'System.Misc.Network.MAC_Address_Filter',
    'System.Misc.Network.DMC_Control',
    'System.Misc.Network.Network_Name',
    'System.Misc.Network.YNCA_Port',
    'System.Misc.Trig_Out.Trig_1.Manual_Control',
    'System.Misc.Trig_Out.Trig_1.Type',
    'System.Misc.Trig_Out.Trig_1.Zone',
    'System.Misc.Trig_Out.Trig_1.Input',
    'System.Misc.DC_OUT.Type',
    'System.Misc.Advanced_Setup.Speaker_Impedance',
    'System.Misc.Advanced_Setup.Remote_Control_ID',
    'System.Misc.Advanced_Setup.Initialize',
    'System.Misc.Advanced_Setup.TV_Format',
    'System.Misc.Advanced_Setup.HDMI_Monitor_Check',
    'System.Misc.Memory_Guard',
    'System.Misc.Event.Notice',
    'Main_Zone.Config',
    'Main_Zone.Basic_Status',
    'Main_Zone.Power_Control.Power',
    'Main_Zone.Power_Control.Sleep',
    'Main_Zone.Volume.Lvl',
    'Main_Zone.Volume.Mute',
    'Main_Zone.Volume.Subwoofer_Trim',
    'Main_Zone.Volume.Max_Lvl',
    'Main_Zone.Volume.Init_Lvl',
    'Main_Zone.Volume.Memory.Memory_1',
    'Main_Zone.Volume.Memory.Memory_2',
    'Main_Zone.Volume.Memory.Memory_3',
    'Main_Zone.Volume.Memory.Memory_4',
    'Main_Zone.Volume.Memory.Memory_5',
    'Main_Zone.Volume.Memory.Memory_6',
    'Main_Zone.Input.Input_Sel',
    'Main_Zone.Input.Decoder_Sel.Current',
    'Main_Zone.Input.Decoder_Sel.HDMI_1',
    'Main_Zone.Input.Decoder_Sel.HDMI_2',
    'Main_Zone.Input.Decoder_Sel.HDMI_3',
    'Main_Zone.Input.Decoder_Sel.HDMI_4',
    'Main_Zone.Input.Decoder_Sel.HDMI_5',
    'Main_Zone.Input.Decoder_Sel.AV_1',
    'Main_Zone.Input.Decoder_Sel.AV_2',
    'Main_Zone.Input.Decoder_Sel.AV_3',
    'Main_Zone.Input.Decoder_Sel.AV_4',
    'Main_Zone.Input.Decoder_Sel.V_AUX',
    'Main_Zone.Scene.Scene_1',
    'Main_Zone.Scene.Scene_2',
    'Main_Zone.Scene.Scene_3',
    'Main_Zone.Scene.Scene_4',
    'Main_Zone.Sound_Video.Headphone',
    'Main_Zone.Sound_Video.Tone.Bass',
    'Main_Zone.Sound_Video.Tone.Treble',
    'Main_Zone.Sound_Video.Pure_Direct.Mode',
    'Main_Zone.Sound_Video.YPAO_Volume',
    'Main_Zone.Sound_Video.Extra_Bass',
    'Main_Zone.Sound_Video.Adaptive_DRC',
    'Main_Zone.Sound_Video.Dialogue_Adjust.Dialogue_Lift',
    'Main_Zone.Sound_Video.Dialogue_Adjust.Dialogue_Lvl',
    'Main_Zone.Surround.Program_Sel.Current',
    'Main_Zone.Surround.Program_Sel.TUNER',
    'Main_Zone.Surround.Program_Sel.HDMI_1',
    'Main_Zone.Surround.Program_Sel.HDMI_2',
    'Main_Zone.Surround.Program_Sel.HDMI_3',
    'Main_Zone.Surround.Program_Sel.HDMI_4',
    'Main_Zone.Surround.Program_Sel.HDMI_5',
    'Main_Zone.Surround.Program_Sel.AV_1',
    'Main_Zone.Surround.Program_Sel.AV_2',
    'Main_Zone.Surround.Program_Sel.AV_3',
    'Main_Zone.Surround.Program_Sel.AV_4',
    'Main_Zone.Surround.Program_Sel.AV_5',
    'Main_Zone.Surround.Program_Sel.AV_6',
    'Main_Zone.Surround.Program_Sel.V_AUX',
    'Main_Zone.Surround.Program_Sel.AUDIO_1',
    'Main_Zone.Surround.Program_Sel.AUDIO_2',
    'Main_Zone.Surround.Program_Sel.Napster',
    'Main_Zone.Surround.Program_Sel.Spotify',
    'Main_Zone.Surround.Program_Sel.JUKE',
    'Main_Zone.Surround.Program_Sel.SERVER',
    'Main_Zone.Surround.Program_Sel.NET_RADIO',
    'Main_Zone.Surround.Program_Sel.USB',
    'Main_Zone.Surround.Program_Sel.AirPlay',
    'Main_Zone.Surround.Sound_Program_Param.CLASSICAL',
    'Main_Zone.Surround.Sound_Program_Param.LIVE_CLUB',
    'Main_Zone.Surround.Sound_Program_Param.ENTERTAINMENT',
    'Main_Zone.Surround.Sound_Program_Param.MOVIE',
    'Main_Zone.Surround.Sound_Program_Param.STEREO',
    'Main_Zone.Surround.Sound_Program_Param.SUR_DECODE',
    'Main_Zone.Surround.Adaptive_DSP_Lvl',
    'Main_Zone.Surround._3D_Cinema_DSP',
    'Main_Zone.Surround.Extended_Sur_Decoder_Sel',
    'Main_Zone.Surround._2ch_Decoder_Sel',
    'Main_Zone.Cursor_Control.Contents_Display',
    'Zone_2.Config',
    'Zone_2.Basic_Status',
    'Zone_2.Power_Control.Power',
    'Zone_2.Power_Control.Sleep',
    'Zone_2.Volume.Lvl',
    'Zone_2.Volume.Mute',
    'Zone_2.Volume.Max_Lvl',
    'Zone_2.Volume.Init_Lvl',
    'Zone_2.Volume.Memory.Memory_1',
    'Zone_2.Volume.Memory.Memory_2',
    'Zone_2.Volume.Memory.Memory_3',
    'Zone_2.Volume.Memory.Memory_4',
    'Zone_2.Volume.Memory.Memory_5',
    'Zone_2.Volume.Memory.Memory_6',
    'Zone_2.Input.Input_Sel',
    'Tuner.Config',
    'Tuner.Play_Control.Search_Mode',
    'Tuner.Play_Control.Preset.Preset_Sel',
    'Tuner.Play_Control.Preset.Data',
    'Tuner.Play_Control.Tuning',
    'Tuner.Play_Control.FM_Mode',
    'Tuner.Play_Info',
    'Napster.Config',
    'Napster.Play_Control.Play_Mode.Repeat',
    'Napster.Play_Control.Play_Mode.Shuffle',
    'Napster.Play_Info',
    'Napster.List_Info',
    'Spotify.Config',
    'Spotify.Play_Info',
    'JUKE.Config',
    'JUKE.Play_Control.Play_Mode.Repeat',
    'JUKE.Play_Control.Play_Mode.Shuffle',
    'JUKE.Play_Info',
    'JUKE.List_Info',
    'SERVER.Config',
    'SERVER.Play_Control.Play_Mode.Repeat',
    'SERVER.Play_Control.Play_Mode.Shuffle',
    'SERVER.Play_Info',
    'SERVER.List_Info',
    'NET_RADIO.Config',
    'NET_RADIO.Play_Info',
    'NET_RADIO.List_Info',
    'USB.Config',
    'USB.Play_Control.Play_Mode.Repeat',
    'USB.Play_Control.Play_Mode.Shuffle',
    'USB.Play_Info',
    'USB.List_Info',
    'iPod_USB.Config',
    'iPod_USB.Play_Control.iPod_Mode',
    'iPod_USB.Play_Control.Play_Mode.Repeat',
    'iPod_USB.Play_Control.Play_Mode.Shuffle',
    'iPod_USB.Play_Info',
    'iPod_USB.List_Info',
    'AirPlay.Config',
    'AirPlay.Play_Info'
  ];

  RED.httpAdmin.get('/avryamaha/referencesGet', function(req, res, next){
    res.end(JSON.stringify(referencesGet));
    return;
  });

};
