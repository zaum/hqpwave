# HQPWV

HQPWV is a local webserver that allows you to remotely control [HQPlayer](https://www.signalyst.com/consumer.html)  from any device on your network using a web browser.

[End-user installation instructions](https://github.com/zeropointnine/hqpwv/blob/master/readme_enduser.md)

[Discussion thread on audiophilestyle](https://audiophilestyle.com/forums/topic/63831-hqpwv-hqplayer-web-viewer)

!Development setup

1. `cd` to the project directory.
  
2. Make sure Node.js is installed. Then enter:
   `npm install`.
3. Make sure [HQPlayer 4](https://www.signalyst.com/consumer.html) is running.
4. Start the server:
   `node server/server.js`
5. Browse to the locally served webpage as directed.

Executables are generated with `pkg` by simply entering:
`pkg .`

Front-end code consists of untranspiled, vanilla ES6 classes.
