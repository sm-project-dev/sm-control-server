require('dotenv').config();

const ENV = process.env;

const { controllerParserType } = require('../../../src/module').di.dccFlagModel;

/** @type {integratedDataLoggerConfig} */
const config = {
  uuid: ENV.PJ_UUID || '001',
  projectInfo: {
    projectMainId: 'UPSAS',
    projectSubId: 'muan',
    featureConfig: {
      apiConfig: {
        type: 'socket',
        host: process.env.PJ_HTTP_HOST,
        port: process.env.PJ_API_PORT,
        addConfigInfo: {
          parser: controllerParserType.socket.DELIMITER,
          option: '\u0004',
        },
      },
      powerStatusBoardConfig: {
        type: 'serial',
        baudRate: 9600,
        port: 'COM17',
      },
    },
  },
  /** @type {dbInfo} */
  dbInfo: {
    port: ENV.PJ_DB_PORT || '3306',
    host: ENV.PJ_DB_HOST || 'localhost',
    user: ENV.PJ_DB_USER || 'root',
    password: ENV.PJ_DB_PW || 'test',
    database: ENV.PJ_DB_DB || 'test',
  },
  inquirySchedulerInfo: {
    intervalCronFormat: '0 * * * * *',
    intervalSaveCnt: 1,
    validInfo: {
      diffType: 'minutes',
      duration: 2,
    },
  },
  dataLoggerList: [],
};
module.exports = config;
