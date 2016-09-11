# Node-RED nodes for Yamaha audio/video receiver (AVR)
This package contains nodes for to easily integrate and control YAMAHA™ audio/video receiver from Node-Red (e.g. AVRs like the model Yamaha RX-677).

## Installation
Use `npm install node-red-contrib-avr-yamaha` to install.

## Usage
There are 3 new nodes which appear in the category 'devices' in your Node-Red palette. Use the config node to set the IP address of your receiver.

Hint: To power on the AVR from remote, the network standby has to be enabled in the internal settings of the AVR.


## History
- 2016-feb-20: 0.1.0 - Created node to read status of the receiver.
- 2016-mar-04: 0.3.0 - GET and PUT nodes are working to read and write to the receiver.
- 2016-mar-17: 0.4.0 - Input node emits new message on volume change, power mode and input change.
- 2016-may-17: 0.5.0 - Fixed errors when writing some values like volume or tuner frequency.
- 2016-sep-11: 0.5.1 - Opening UPnP socket with reuseAddr so there can be more than one UPnP listener running.

## Credits
- Sebastian Krauskopf (sebakrau)
- This library uses the yamaha-nodejs library by Pascal Seitz.

## Trademarks
- "YAMAHA" is a registered trademark of Yamaha Corporation.

## License
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
