const _ = require('lodash');

const { BU } = require('base-util-jh');

const { di, dpc } = require('../../module');

const {
  dcmConfigModel: {
    reqWrapCmdFormat: reqWCF,
    reqWrapCmdType: reqWCT,
    nodePickKey,
    commandPickKey,
  },
  dcmWsModel: { transmitToServerCommandType: transmitToServerCT },
} = di;

const AbstApiClient = require('./AbstApiClient');

class ApiClient extends AbstApiClient {
  /** @param {MainControl} controller */
  constructor(controller) {
    super(controller);
    this.coreFacade = controller.coreFacade;

    this.reconectScheduler;
  }

  /** API Server 연결 해제시 재접속 */
  runCronReconnect() {
    if (this.reconectScheduler !== undefined) {
      clearInterval(this.reconectScheduler);
    }
    // 즉시 접속
    this.transmitDataToServer({
      commandType: transmitToServerCT.CERTIFICATION,
      data: this.controller.mainUUID,
    });

    this.reconectScheduler = setInterval(() => {
      // BU.log(
      //   `setInterval Reconnect >>> ${this.controller.mainUUID} ${this.hasCertification}`,
      // );
      if (!this.hasCertification) {
        // BU.log(
        //   `setInterval Reconnect >>> ${this.controller.mainUUID} ${
        //     this.hasCertification
        //   }`,
        // );
        // 장치 접속에 성공하면 인증 시도 (1회만 시도로 확실히 연결이 될 것으로 가정함)
        this.transmitDataToServer({
          commandType: transmitToServerCT.CERTIFICATION,
          data: this.controller.mainUUID,
        });
      }
    }, 1000 * 60);

    return true;
  }

  /**
   * 장치로부터 데이터 수신
   * @override
   * @param {bufData} bufData 현재 장비에서 실행되고 있는 명령 객체
   */
  onData(bufData) {
    try {
      const decodingData = this.defaultConverter.decodingMsg(bufData);
      const strData = decodingData.toString();

      // 형식을 지켜서 보낸 명령만 대응
      if (!BU.IsJsonString(strData)) {
        return BU.errorLog('onDataError', strData);
      }

      /** @type {defaultFormatToResponse|defaultFormatToRequest} */
      const apiData = JSON.parse(strData);

      if (_.isNumber(apiData.isError)) {
        return this.onResponseData(apiData);
      }
      return this.onRequestData(apiData);
    } catch (error) {
      BU.logFile(error);
      throw error;
    }
  }

  /**
   *
   * @param {defaultFormatToResponse} responseData
   */
  onResponseData(responseData) {
    const { commandId, contents, isError, message } = responseData;

    switch (commandId) {
      // 보낸 명령이 CERTIFICATION 타입이라면 체크
      case transmitToServerCT.CERTIFICATION:
        BU.log('@@@ Authentication is completed from the Socket Server.');
        this.hasCertification = isError === 0;
        // 인증이 완료되었다면 현재 노드 데이터를 서버로 보냄
        this.hasCertification && this.transmitStorageDataToServer();
        // 인증이 완료되고 현황판이 존재할 경우 현황판 크론 구동
        this.hasCertification &&
          _.get(this, 'controller.powerStatusBoard') &&
          this.controller.powerStatusBoard.runCronRequestPowerStatusBoard();
        break;
      // 수신 받은 현황판 데이터 전송
      case transmitToServerCT.POWER_BOARD:
        _.get(this, 'controller.powerStatusBoard') &&
          this.controller.powerStatusBoard.onDataFromApiClient(message, contents);
        break;
      default:
        break;
    }
  }

  /**
   *
   * @param {defaultFormatToRequest} requestData
   */
  onRequestData(requestData) {
    const { commandId } = requestData;
    switch (commandId) {
      // 보낸 명령이 CERTIFICATION 타입이라면 체크
      case transmitToServerCT.COMMAND:
        // 요청 받은 명령에 대해서는 NEXT를 수행하지 않고 분석기에게 권한을 넘김
        this.interpretRequestedCommand(requestData);
        break;
      // 수신 받은 현황판 데이터 전송
      case transmitToServerCT.MODE:
        // 요청 받은 명령에 대해서는 NEXT를 수행하지 않고 분석기에게 권한을 넘김
        this.interpretRequestChores(requestData);
        break;
      default:
        break;
    }
  }

  /**
   * 초기 구동 개시
   */
  startOperation() {
    BU.log(`startOperation >>> ${this.controller.mainUUID}`);
    // 장치 접속에 성공하면 인증 시도 (1회만 시도로 확실히 연결이 될 것으로 가정함)
    this.runCronReconnect();
  }

  endOperation() {
    // BU.log(`endOperation >>> ${this.controller.mainUUID}`);

    this.hasCertification = false;

    if (this.reconectScheduler !== undefined) {
      clearInterval(this.reconectScheduler);
      // 스케줄러 해제
      this.reconectScheduler = undefined;
    }
  }

  /**
   * Device Controller에서 새로운 이벤트가 발생되었을 경우 알림
   * @param {string} eventName 'dcConnect' 연결, 'dcClose' 닫힘, 'dcError' 에러
   */
  onEvent(eventName) {
    // BU.CLI(eventName);
    const { CONNECT, DISCONNECT } = this.definedControlEvent;

    switch (eventName) {
      // 연결 수립이 되면 최초 1번에 한해서 초기 구동 명령을 요청
      case CONNECT:
        this.startOperation();
        break;
      // Socket 연결이 해제되면 인증 여부를 false로 되돌림.
      case DISCONNECT:
        this.endOperation();
        break;
      default:
        break;
    }
  }

  /**
   * @desc DataLogger --> Server 데이터 보고. (보고에 관한 추적은 하지 않으므로 onData 메소드에서 별도의 처리는 하지 않음)
   * DataLogger Default 명령을 내리기 위함
   * @param {transDataToServerInfo} transDataToServerInfo
   */
  transmitDataToServer(transDataToServerInfo = {}) {
    const { commandType, data } = transDataToServerInfo;
    try {
      // 소켓 연결이 되지 않으면 명령 전송 불가
      if (!this.isConnect) {
        throw new RangeError('The socket is not connected yet.');
      }
      // 인증이 되지 않았는데 별도의 데이터를 보낼 수는 없음
      if (commandType !== transmitToServerCT.CERTIFICATION && !this.hasCertification) {
        throw new Error('Authentication must be performed first');
      }

      /** @type {defaultFormatToRequest} 기본 전송규격 프레임에 넣음 */
      const transmitDataToServer = {
        commandId: commandType,
        contents: data,
      };

      const encodingData = this.defaultConverter.encodingMsg(transmitDataToServer);

      // 명령 전송 성공 유무 반환
      return this.write(encodingData)
        .then(() => true)
        .catch(err => BU.errorLog('transmitDataToServer', err));
    } catch (error) {
      // Range Error가 발생하면 소켓 연결이 되지 않은 것으로 판단
      if (error instanceof RangeError) {
        return false;
      }

      BU.errorLog('error', 'transmitDataToServer', error.message);
    }
  }

  /**
   * 서버로 현재 진행중인 데이터(노드, 명령)를 보내줌
   */
  transmitStorageDataToServer() {
    /** @type {wsModeInfo} */
    const modeInfo = {
      algorithmId: this.coreFacade.coreAlgorithm.algorithmId,
      operationConfigList: this.coreFacade.coreAlgorithm.getOperationConfigList(),
    };

    // 구동 모드 현황
    this.transmitDataToServer({
      commandType: transmitToServerCT.MODE,
      data: modeInfo,
    });
    // 노드 현황(Sumit API 요소만 전송)
    this.transmitDataToServer({
      commandType: transmitToServerCT.NODE,
      data: this.controller.model.getAllNodeStatus(
        nodePickKey.FOR_SERVER,
        _.filter(this.controller.nodeList, 'is_submit_api'),
      ),
    });
    // 명령 현황
    this.transmitDataToServer({
      commandType: transmitToServerCT.COMMAND,
      data: this.controller.model.getAllCmdStatus(),
    });

    // SVG Img 현황
    this.transmitDataToServer({
      commandType: transmitToServerCT.SVG_IMG,
      data: this.controller.model.getAllSvgImg(),
    });
  }

  /**
   * 잡일을 처리함
   * @param {defaultFormatToRequest} responsedDataByServer
   */
  interpretRequestChores(responsedDataByServer) {
    const { MODE } = transmitToServerCT;
    const { commandId, contents, uuid } = responsedDataByServer;
    /** @type {defaultFormatToResponse} */
    const responseMsg = {
      commandId,
      uuid,
      isError: 0,
      message: '',
      contents: {},
    };

    try {
      // 모드 관련 내용을 보고자 할 때
      if (commandId === MODE) {
        const isChanged = this.controller.changeOperationMode(contents);
        if (isChanged) {
          responseMsg.message = '정상적으로 구동 모드를 변경하였습니다.';
        } else {
          throw new Error('변경하고자 하는 구동 모드 상태를 확인해주시기 바랍니다.');
        }
      }

      // 기본 전송 프레임으로 감쌈.
      const encodingMsg = this.defaultConverter.encodingMsg(responseMsg);

      // DCC에 전송 명령
      return this.write(encodingMsg);
    } catch (error) {
      responseMsg.isError = 1;
      responseMsg.message = _.get(error, 'message');

      // 기본 전송 프레임으로 감쌈.
      const encodingMsg = this.defaultConverter.encodingMsg(responseMsg);

      // DCC에 전송 명령
      return this.write(encodingMsg);
    }
  }

  /**
   * @desc Server --> DataLogger 명령 수행 요청 처리
   * 수신받은 데이터가 명령 요청인지 체크하고 맞다면 명령을 수행
   * @param {defaultFormatToRequest} responsedDataByServer
   */
  interpretRequestedCommand(responsedDataByServer) {
    const { commandId, contents, uuid } = responsedDataByServer;
    /** @type {defaultFormatToResponse} */
    const responseMsg = {
      commandId,
      uuid,
      isError: 0,
      message: '',
      contents: {},
    };

    try {
      /** @type {wsControlCmdAPI} 웹 API Server에서 받은 명령 정보 비구조화할당 이름 재정의 */
      const {
        WCU: wrapCmdUUID,
        WCF: wrapCmdFormat,
        WCT: wrapCmdType,
        WCI: wrapCmdId,
        WCN: wrapCmdName,
        WCG: wrapCmdGoalInfo,
        SCT: singleControlType,
        CSV: controlSetValue,
        NI: nodeId,
        SPI,
        DPI,
        rank,
      } = contents;

      /** @type {reqCommandInfo} DBS에서 사용될 명령 Format 으로 변경 */
      const reqCmdInfo = {
        wrapCmdUUID,
        wrapCmdFormat,
        wrapCmdType,
        wrapCmdId,
        wrapCmdName,
        wrapCmdGoalInfo,
        rank,
        singleControlType,
        controlSetValue,
        nodeId,
        srcPlaceId: SPI,
        destPlaceId: DPI,
      };

      let cmdStorage;
      let scenarioStroage;

      // wrapCmdUUID가 존재하고 명령 타입이 취소일 경우 명령 스토리지에 존재하는 명령 저장소에 취소 요청
      if (typeof wrapCmdUUID === 'string' && wrapCmdType === reqWCT.CANCEL) {
        cmdStorage = this.controller.executeCancelCommand(reqCmdInfo);
      } else {
        switch (wrapCmdFormat) {
          case reqWCF.SINGLE:
            cmdStorage = this.controller.executeSingleControl(reqCmdInfo);
            break;
          case reqWCF.SET:
            cmdStorage = this.controller.executeSetControl(reqCmdInfo);
            break;
          case reqWCF.FLOW:
            cmdStorage = this.controller.executeFlowControl(reqCmdInfo);
            break;
          case reqWCF.SCENARIO:
            // FIXME: 시나리오 반환값은 cmdStorage가 아님. 필요한 값만 get 처리 함
            cmdStorage = this.controller.executeScenarioControl(reqCmdInfo);
            break;
          default:
            responseMsg.isError = 1;
            responseMsg.message = `WCT: ${wrapCmdFormat} is not defined`;
            break;
        }
      }

      if (cmdStorage === undefined && scenarioStroage === undefined) {
        throw new Error(`WCT: ${wrapCmdFormat} is not defined`);
      }

      responseMsg.contents = _.pick(cmdStorage, commandPickKey.FOR_SERVER);
      // 기본 전송 프레임으로 감쌈.
      const encodingMsg = this.defaultConverter.encodingMsg(responseMsg);

      // DBW에 전송 명령
      return this.write(encodingMsg);
    } catch (error) {
      console.dir(error.message);
      responseMsg.isError = 1;
      responseMsg.message =
        process.env.NODE_ENV === 'production' ? error.message : error.stack;

      // 기본 전송 프레임으로 감쌈.
      const encodingMsg = this.defaultConverter.encodingMsg(responseMsg);

      // DBW에 전송 명령
      return this.write(encodingMsg);
    }
  }
}
module.exports = ApiClient;
