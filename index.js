const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
require('events').EventEmitter.defaultMaxListeners = 2000;

const app = express();
const PORT = process.env.PORT || 5000;
__path = process.cwd();

const { 
  qrRoute,
  pairRoute
} = require('./routes');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/qr', qrRoute);
app.use('/code', pairRoute);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

module.exports = app;
