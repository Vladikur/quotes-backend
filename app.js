const cors = require('cors');
const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();
const helmet = require('helmet');
const { apiLimiter } = require('./middlewares/rateLimit');
const { requestLogger, errorLogger } = require('./middlewares/logger');
const quotesRoutes = require('./routes/quotes');
const loginRoutes = require('./routes/login');

const { PORT = 3000 } = process.env;

const app = express();

app.use(cors());

app.use(helmet());

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

app.use(requestLogger);

app.use(apiLimiter);

app.use('/api/auth', loginRoutes);
app.use('/api/quotes', quotesRoutes);

app.use(errorLogger);

app.listen(PORT, () => console.log('ok'));