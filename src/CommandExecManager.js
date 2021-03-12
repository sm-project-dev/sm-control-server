const _ = require('lodash');

const { BU } = require('base-util-jh');

const {
  dcmConfigModel: {
    reqWrapCmdType: reqWCT,
    reqWrapCmdFormat: reqWCF,
    reqDeviceControlType: reqDCT,
  },
  dccFlagModel: { definedCommandSetRank },
} = require('./module').di;

class CommandExecManager {
  /**
   * Creates an instance of Model.
   * @param {MainControl} controller
   */
  constructor(controller) {
    this.controller = controller;

    const {
      coreFacade,
      model,
      mdControlIdenStorage,
      nodeList,
      dataLoggerList,
      mainUUID,
    } = controller;
    // Command Execute Manager 를 Core Facde에 정의
    coreFacade.setCmdExecManager(this);

    this.coreFacade = coreFacade;
    this.model = model;
    this.mdControlIdenStorage = mdControlIdenStorage;
    this.nodeList = nodeList;
    this.dataLoggerList = dataLoggerList;
    this.mainUUID = mainUUID;
  }

  /**
   * 계측 명령
   * @param {reqMeasureCmdInfo} reqMeasureCmdInfo
   */
  executeMeasure(reqMeasureCmdInfo) {
    const {
      wrapCmdType = reqWCT.CONTROL,
      wrapCmdId,
      wrapCmdName,
      searchIdList,
      rank,
    } = reqMeasureCmdInfo;

    /** @type {reqCommandInfo} 명령 실행 설정 객체 */
    const reqCommandOption = {
      wrapCmdFormat: reqWCF.MEASURE,
      wrapCmdType,
      wrapCmdId,
      wrapCmdName,
      rank,
      reqCmdEleList: [
        {
          singleControlType: reqDCT.MEASURE,
          searchIdList,
          rank,
        },
      ],
    };

    return this.executeCommand(reqCommandOption);
  }

  /**
   * @desc 수동 모드에서만 사용 가능
   * 외부에서 단일 명령을 내릴경우
   * @param {reqSingleCmdInfo} reqSingleCmdInfo
   */
  executeSingleControl(reqSingleCmdInfo) {
    const {
      wrapCmdType = reqWCT.CONTROL,
      nodeId,
      singleControlType,
      controlSetValue,
      rank = definedCommandSetRank.SECOND,
      wrapCmdGoalInfo,
    } = reqSingleCmdInfo;

    // 제어하고자 하는 노드 정보를 가져옴
    try {
      // 다중 배열 Node 가 들어올 경우
      if (_.isArray(nodeId)) {
        // 사용자가 알 수 있는 제어 구문으로 변경
        /** @type {reqCommandInfo} 명령 실행 설정 객체 */
        const reqCommandOption = {
          wrapCmdFormat: reqWCF.SINGLE,
          wrapCmdType,
          wrapCmdId: `${nodeId.toString()}_${singleControlType}`,
          wrapCmdName: `${nodeId.toString()}_${singleControlType}`,
          reqCmdEleList: [
            {
              singleControlType,
              controlSetValue,
              searchIdList: nodeId,
            },
          ],
          wrapCmdGoalInfo,
          rank,
        };
        return this.executeCommand(reqCommandOption);
      }
      const { node_name: nName, nc_target_id: ncId } = _.find(this.nodeList, {
        node_id: nodeId,
      });

      const { enName, krName } = this.mdControlIdenStorage
        .get(ncId)
        .get(singleControlType);

      /** @type {reqCommandInfo} 명령 실행 설정 객체 */
      const reqCommandOption = {
        wrapCmdFormat: reqWCF.SINGLE,
        wrapCmdType,
        wrapCmdId: `${nodeId}_${enName}${
          _.isEmpty(controlSetValue) ? '' : `_${controlSetValue}`
        }`,
        wrapCmdName: `${nName} ${krName}`,
        reqCmdEleList: [
          {
            singleControlType,
            searchIdList: [nodeId],
          },
        ],
        wrapCmdGoalInfo,
        rank,
      };
      return this.executeCommand(reqCommandOption);
    } catch (error) {
      // BU.CLIN(error);
      BU.errorLog('excuteControl', 'Error', error);
      throw error;
    }
  }

  /**
   * 설정 명령 요청 수행
   * @param {reqSetCmdInfo} reqSetCmdInfo 저장된 명령 ID
   */
  executeSetControl(reqSetCmdInfo) {
    const {
      wrapCmdId,
      wrapCmdType = reqWCT.CONTROL,
      rank = definedCommandSetRank.SECOND,
      wrapCmdGoalInfo,
    } = reqSetCmdInfo;

    // 설정 명령 조회
    const setCmdInfo = this.model.findSetCommand(wrapCmdId);
    // 세부 흐름 명령이 존재하지 않을 경우
    if (_.isEmpty(setCmdInfo)) {
      throw new Error(`set command: ${wrapCmdId} not found`);
    }

    /** @type {reqCommandInfo} 명령 실행 설정 객체 */
    const reqCommandOption = {
      wrapCmdFormat: reqWCF.SET,
      wrapCmdType,
      wrapCmdId,
      wrapCmdName: setCmdInfo.cmdName,
      reqCmdEleList: this.makeControlEleCmdList(setCmdInfo, rank),
      wrapCmdGoalInfo,
      rank,
    };

    return this.executeCommand(reqCommandOption);
  }

  /**
   * 흐름 명령을 요청할 경우
   * @param {reqFlowCmdInfo} reqFlowCmdInfo
   */
  executeFlowControl(reqFlowCmdInfo) {
    const {
      srcPlaceId,
      destPlaceId,
      wrapCmdType = reqWCT.CONTROL,
      wrapCmdGoalInfo,
      rank = definedCommandSetRank.SECOND,
    } = reqFlowCmdInfo;

    // 세부 명령 흐름 조회
    const flowCmdDestInfo = this.model.findFlowCommand(reqFlowCmdInfo);
    // 세부 흐름 명령이 존재하지 않을 경우
    if (_.isEmpty(flowCmdDestInfo)) {
      throw new Error(`The flow command: ${srcPlaceId}_TO_${destPlaceId} not found`);
    }

    /** @type {reqCommandInfo} 명령 실행 설정 객체 */
    const reqCommandOption = {
      wrapCmdFormat: reqWCF.FLOW,
      wrapCmdType,
      wrapCmdId: flowCmdDestInfo.cmdId,
      wrapCmdName: flowCmdDestInfo.cmdName,
      srcPlaceId,
      destPlaceId,
      reqCmdEleList: this.makeControlEleCmdList(flowCmdDestInfo, rank),
      wrapCmdGoalInfo,
      rank,
    };

    return this.executeCommand(reqCommandOption);
  }

  /**
   * 시나리오를 수행하고자 할 경우
   * @param {reqScenarioCmdInfo} reqScenarioCmdInfo 시나리오 명령 정보
   */
  executeScenarioControl(reqScenarioCmdInfo) {
    // BU.CLIN(reqScenarioCmdInfo);
    const {
      wrapCmdId,
      wrapCmdType = reqWCT.CONTROL,
      rank = definedCommandSetRank.SECOND,
    } = reqScenarioCmdInfo;

    const scenarioCmdInfo = this.model.findScenarioCommand(wrapCmdId);
    // 세부 흐름 명령이 존재하지 않을 경우
    if (_.isEmpty(scenarioCmdInfo)) {
      throw new Error(`scenario command: ${wrapCmdId} not found`);
    }

    const { cmdName, scenarioCount = 1 } = scenarioCmdInfo;

    /** @type {reqCommandInfo} 명령 실행 설정 객체 */
    const reqCommandOption = {
      wrapCmdFormat: reqWCF.SCENARIO,
      wrapCmdType,
      wrapCmdId,
      wrapCmdName: cmdName,
      rank,
      scenarioCount,
    };

    return this.coreFacade.cmdManager.executeCommand(reqCommandOption);
    // return this.model.scenarioManager.initScenario(reqCommandOption);
  }

  /**
   * 명령을 세부 제어 목록 반환
   * @param {trueAndFalseCmdInfo} trueAndFalseCmdInfo
   * @param {number} rank
   */
  makeControlEleCmdList(trueAndFalseCmdInfo, rank) {
    // BU.error(trueAndFalseCmdInfo);
    /** @type {reqCmdEleInfo[]} */
    const reqCmdEleList = [];
    const { trueNodeList = [], falseNodeList = [] } = trueAndFalseCmdInfo;
    if (trueNodeList.length) {
      reqCmdEleList.push({
        singleControlType: reqDCT.TRUE,
        nodeId: trueNodeList,
        searchIdList: trueNodeList,
        rank,
      });
    }

    // 장치 False 요청
    if (falseNodeList.length) {
      reqCmdEleList.push({
        singleControlType: reqDCT.FALSE,
        nodeId: falseNodeList,
        searchIdList: falseNodeList,
        rank,
      });
    }
    return reqCmdEleList;
  }

  /**
   * 최종적으로 명령 생성 및 실행 요청
   * @param {reqCommandInfo} reqCommandInfo
   */
  executeCommand(reqCommandInfo) {
    const { reqCmdEleList, wrapCmdFormat, wrapCmdName } = reqCommandInfo;

    reqCmdEleList.forEach(reqCmdEleInfo => {
      const { searchIdList } = reqCmdEleInfo;
      reqCmdEleInfo.searchIdList = _.reject(searchIdList, searchId => {
        const dlc = this.model.findDataLoggerController(searchId);
        let errMsg = '';
        if (_.isUndefined(dlc)) {
          errMsg = `DLC: ${searchId}가 존재하지 않습니다.`;
        } else if (!dlc.isAliveDLC) {
          errMsg = `명령: (${wrapCmdName})을 수행할 수 없습니다. 장치 상태를 점검해주세요.`;
          // errMsg = `${searchId}는 장치와 연결되지 않았습니다.`;
        }
        // 계측 명령이 아니면 명령에 DataLogger가 식별되지 않는다면 요청 불가
        if (wrapCmdFormat !== reqWCF.MEASURE && errMsg.length) {
          throw new Error(errMsg);
        }

        return errMsg.length;
      });
    });

    // BU.CLI(reqCmdEleList);

    return this.coreFacade.cmdManager.executeCommand(reqCommandInfo);
  }

  /**
   * 기존에 실행 중인 명령을 취소하고자 할 경우
   * @param {executeCmdInfo} executeCmdInfo
   */
  executeCancelCommand(executeCmdInfo) {
    // 기본 값 CANCEL로 설정
    executeCmdInfo.wrapCmdType = reqWCT.CANCEL;
    return this.coreFacade.cmdManager.executeCommand(executeCmdInfo);
  }

  /**
   * 정기적인 Router Status 탐색
   */
  inquiryAllDeviceStatus() {
    process.env.LOG_DBS_INQUIRY_START === '1' &&
      BU.CLI(`${this.makeCommentMainUUID()} Start inquiryAllDeviceStatus`);
    /** @type {reqMeasureCmdInfo} */
    const reqMeasureCmdOption = {
      wrapCmdId: 'inquiryAllDeviceStatus',
      wrapCmdName: '정기 장치 상태 계측',
      searchIdList: _.map(this.dataLoggerList, 'dl_id'),
    };

    return this.executeMeasure(reqMeasureCmdOption);
  }

  /** MainUUID 가 존재할 경우 해당 지점을 알리기 위한 텍스트 생성 */
  makeCommentMainUUID() {
    if (this.mainUUID.length) {
      return `MainUUID: ${this.mainUUID}`;
    }
    return '';
  }
}
module.exports = CommandExecManager;
