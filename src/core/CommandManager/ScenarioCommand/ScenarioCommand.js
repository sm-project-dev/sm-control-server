const _ = require('lodash');

const { BU } = require('base-util-jh');

const {
  dcmConfigModel: { commandStep: cmdStep, reqWrapCmdFormat: reqWCF },
} = require('../../../module').di;

const ScenarioComponent = require('./ScenarioComponent');

class ScenarioCommand extends ScenarioComponent {
  /**
   *
   * @param {mScenariCmdInfo} scenarioCmdInfo
   * @param {CoreFacade} coreFacade
   */
  constructor(scenarioCmdInfo, coreFacade) {
    super();

    this.coreFacade = coreFacade;
    this.scenarioCmdInfo = scenarioCmdInfo;
    const { imgDisplayList = [] } = scenarioCmdInfo;
    this.imgDisplayList = imgDisplayList;

    /** @type {ScenarioComponent} */
    this.scenarioStorage;

    /** @type {CmdStorage} */
    this.cmdStorage;

    /** 시나리오 명령 실행 완료 여부 */
    this.isClear = false;

    _.once(this.executeScenario);
  }

  /**
   * handleScenarioClear 성공하였을 경우 알릴 Successor
   * @param {ScenarioComponent} scenarioStorage
   */
  setSuccessor(scenarioStorage) {
    this.scenarioStorage = scenarioStorage;
  }

  /**
   * 시나리오 동기 명령인지 여부
   * @return {boolean}
   */
  getIsSync() {
    return this.scenarioStorage.getIsSync();
  }

  /** 시나리오 명령 실행 */
  executeScenario() {
    try {
      const {
        wrapCmdFormat,
        wrapCmdType,
        wrapCmdGoalInfo,
        singleControlType,
        singleControlSetValue,
        singleNodeId,
        setCmdId,
        flowSrcPlaceId,
        flowDestPlaceId,
        rank,
      } = this.scenarioCmdInfo;

      if (!Object.values(reqWCF).includes(wrapCmdFormat))
        return this.scenarioStorage.handleScenarioFail();

      // 명령 형식에 따라 제어 요청
      switch (wrapCmdFormat) {
        case reqWCF.SINGLE:
          this.cmdStorage = this.coreFacade.executeSingleControl({
            wrapCmdType,
            singleControlType,
            controlSetValue: singleControlSetValue,
            nodeId: singleNodeId,
            wrapCmdGoalInfo,
            rank,
          });
          break;
        case reqWCF.SET:
          this.cmdStorage = this.coreFacade.executeSetControl({
            wrapCmdType,
            wrapCmdId: setCmdId,
            wrapCmdGoalInfo,
            rank,
          });
          break;
        case reqWCF.FLOW:
          this.cmdStorage = this.coreFacade.executeFlowControl({
            wrapCmdType,
            srcPlaceId: flowSrcPlaceId,
            destPlaceId: flowDestPlaceId,
            wrapCmdGoalInfo,
            rank,
          });
          break;
        default:
          // 주어진 명령 형식에 어긋난다면 문제가 있다고 판단하고 시나리오 전체를 취소
          throw new Error();

        // 찾은 객체가 있다면 옵저버 추가
      }
      this.cmdStorage.attachObserver(this);
    } catch (error) {
      this.scenarioStorage.handleScenarioFail();
    }
  }

  /** 시나리오 명령 취소 */
  cancelScenario() {
    // 실행 중인 객체일 경우 삭제 가능
    if (typeof this.cmdStorage === 'object') {
      // 옵저버 삭제
      this.cmdStorage.dettachObserver(this);
      // 명령 저장소에 취소 명령 요청
      this.cmdStorage.cancelCommand([]);
    }
  }

  /** 실행 중인 명령 Id 반환 */
  getWrapCmdId() {
    return this.cmdStorage.wrapCmdId;
  }

  /**
   * CmdStorage에 Observer를 붙인데서 오는 명령 단계 변화 수신
   * 수신받는 이벤트는 PROCEED, COMPLETE, RUNNING, END
   * RESTORE 처리 및 RETORE에 따른 END 이벤트는 취급하지 않음.
   * 즉 수문을 여닫는데 5초가 걸리고 수문을 goal limitTimeSec를 10초를 걸었다면
   * PROCEED는 즉시, RUNNING는 5초 후, END는 15초 후, RESTORE 15초 후, END는 20초 후 가 됨
   *
   * @param {CmdStorage} cmdStorage
   */
  updateCommandStep(cmdStorage) {
    const { wrapCmdStep } = cmdStorage;
    // 시나리오 이미지 변경 객체 찾음
    const imgDisplayInfo = _.find(this.imgDisplayList, { cmdStep: wrapCmdStep });
    // 이미지 변경 객체가 있을 경우 API Server로 전송
    if (_.isObject(imgDisplayInfo)) {
      // API Server로 전송
      this.coreFacade.cmdManager.updateSvgImg(imgDisplayInfo);
    }

    switch (wrapCmdStep) {
      // 명령 추적을 하지 않기 때문에 COMPLETE와 END를 종료 단계로 봄
      case cmdStep.COMPLETE:
      case cmdStep.END:
        // 볼장 다 봤기 때문에 수신 끊음 (RESTORE 부터는 취급하지 않음)
        cmdStorage.dettachObserver(this);
        this.cmdStorage = {};
        this.handleScenarioClear();
        break;
      default:
        this.isClear = false;
        break;
    }
  }

  /** 현재 시나리오 명령 완료 여부 */
  isScenarioClear() {
    return this.isClear;
  }

  /** 단위 명령 요소가 완료되었을 경우 */
  handleScenarioClear() {
    this.isClear = true;
    return this.scenarioStorage.handleScenarioClear();
  }
}
module.exports = ScenarioCommand;
