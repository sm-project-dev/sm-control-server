const _ = require('lodash');
const { BU } = require('base-util-jh');

const {
  dcmConfigModel: {
    commandStep: cmdStep,
    reqWrapCmdType: reqWCT,
    reqDeviceControlType: reqDCT,
  },
} = require('../../../module').di;

const CmdStrategy = require('./CmdStrategy');

class ManualCmdStrategy extends CmdStrategy {
  /**
   * 명령 이벤트가 발생되었을 경우
   * @param {CmdStorage} cmdStorage
   */
  updateCommandStep(cmdStorage) {
    // 달성 목표(Goal)이 없는 명령은 즉시 명령 저장소에서 삭제
    if (cmdStorage.cmdStep === cmdStep.COMPLETE) {
      this.cmdManager.removeCommandStorage(cmdStorage);
    }

    // 명령 Step 최종 단계인 END 일 경우만
    if (cmdStorage.cmdStep === cmdStep.END) {
      // WCT은 둘 중에 하나(CONTROL or CANCEL)

      // 달성 목표(Goal)를 이루었기 때문에 관련된 해당 명령을 복원하는 작업 진행 요청
      if (cmdStorage.wrapCmdType === reqWCT.CONTROL) {
        // 명령 복원이 진행되면 각 명령 Step이 진행됨에 따라 updateCommandStep이 호출되므로 return 처리
        const cancelResult = this.cancelCommand(cmdStorage);

        if (cancelResult === false) {
          this.cmdManager.removeCommandStorage(cmdStorage);
        } else {
          return false;
        }
      }
      // 위에서 명령 복원을 완료하였을 경우 실제적으로 명령 저장소에서 삭제
      else if (cmdStorage.wrapCmdType === reqWCT.CANCEL) {
        this.cmdManager.removeCommandStorage(cmdStorage);
      }
    }

    // 명령 단계가 완료 또는 종료 일 경우
    // if (cmdStorage.cmdStep === cmdStep.COMPLETE || cmdStorage.cmdStep === cmdStep.END) {
    //   // BU.CLI('updateCommandStep >>> ManualCmdStrategy', cmdStorage.cmdStep);
    //   this.cmdManager.removeCommandStorage(cmdStorage);
    // }

    return this.cmdManager.notifyUpdateCommandStep(cmdStorage);
  }

  /**
   * 명령이 존재할 경우 해당 명령 취소, 존재하지 않을 경우 신규 명령 요청
   * @param {reqCommandInfo} reqCmdInfo 기존에 존재하는 명령
   */
  cancelCommand(reqCmdInfo) {
    const { wrapCmdId } = reqCmdInfo;
    // 복원해야할 명령이 있는지 계산
    const foundCmdStoarge = this.cmdManager.getCmdStorage({
      wrapCmdId,
    });

    // 명령이 존재하지 않을 경우 container 계산
    /** @type {commandWrapInfo} */
    const cmdWrapInfo =
      foundCmdStoarge === undefined
        ? this.cmdManager.refineReqCommand(reqCmdInfo)
        : foundCmdStoarge.wrapCmdInfo;

    // 명령 저장소에서 설정 객체를 불러옴
    /** @type {commandContainerInfo[]} Restore Command 생성 */
    const restoreContainerList = _.chain(cmdWrapInfo.containerCmdList)
      // 실제 True 하는 장치 필터링
      .filter({ singleControlType: reqDCT.TRUE })
      // 복원 명령으로 변형
      .map(containerInfo => {
        /** @type {commandContainerInfo} */
        const newContainerInfo = {
          nodeId: containerInfo.nodeId,
          singleControlType: reqDCT.FALSE,
          isIgnore: false,
        };
        return newContainerInfo;
      })
      .value();

    // 복원 시킬 명령이 존재할 경우
    if (restoreContainerList.length) {
      // 복원 명령을 내릴 명령 저장소가 존재하지 않을 경우 신규 생성
      if (_.isEmpty(foundCmdStoarge)) {
        cmdWrapInfo.containerCmdList = restoreContainerList;

        return this.cmdManager.executeRealCommand(cmdWrapInfo, this);
      }
      // 취소 명령 요청
      foundCmdStoarge.cancelCommand(restoreContainerList);

      return foundCmdStoarge;
    }

    // 명령 저장소 존재시 삭제
    return false;
  }

  /**
   * 누적 카운팅에서 공통으로 제어할 명령 로직
   * @param {reqCommandInfo} reqCmdInfo
   */
  executeDefaultControl(reqCmdInfo) {
    const { wrapCmdId, wrapCmdType, wrapCmdName } = reqCmdInfo;

    // 취소 명령 요청이 들어 올 경우
    if (wrapCmdType === reqWCT.CANCEL) {
      return this.cancelCommand(reqCmdInfo);
    }

    // 이미 실행 중인 명령인지 체크
    const existCmdStorage = this.cmdManager.getCmdStorage({
      wrapCmdId,
    });

    // 이미 존재하는 명령이라면 예외 처리
    if (existCmdStorage) {
      throw new Error(`${existCmdStorage.wrapCmdName} 명령은 존재합니다.`);
    }

    // 실제 수행할 장치를 정제
    const commandWrapInfo = this.cmdManager.refineReqCommand(reqCmdInfo);
    this.cmdManager.calcDefaultRealContainerCmd(commandWrapInfo.containerCmdList);

    // 명령을 요청하는 장치 중 식별 되지 않는 장치가 있을 경우 예외처리
    const isFail = commandWrapInfo.containerCmdList.some(cmdEleInfo => {
      const nodeInfo = _.find(this.cmdManager.nodeList, { node_id: cmdEleInfo.nodeId });
      return _.isNil(nodeInfo.data);
    });

    if (isFail) {
      throw new Error(`명령(${wrapCmdName})에는 식별되지 않은 장치가 존재합니다.`);
    }

    // 추가 제어할 장치가 없다면 요청하지 않음
    if (_.every(commandWrapInfo.containerCmdList, { isIgnore: true })) {
      throw new Error(`명령(${wrapCmdName})은 현재 상태와 동일합니다.`);
    }

    return this.cmdManager.executeRealCommand(commandWrapInfo, this);
  }

  /**
   * 단일 제어 명령
   * @param {reqCommandInfo} reqCmdInfo
   */
  executeSingleControl(reqCmdInfo) {
    return this.executeDefaultControl(reqCmdInfo);
  }

  /**
   * 저장된 설정 명령
   * @param {reqCommandInfo} reqCmdInfo
   */
  executeSetControl(reqCmdInfo) {
    return this.executeDefaultControl(reqCmdInfo);
  }

  /**
   * 흐름 명령
   * @param {reqCommandInfo} reqCmdInfo
   */
  executeFlowControl(reqCmdInfo) {
    return this.executeDefaultControl(reqCmdInfo);
  }

  /**
   * 시나리오 명령
   * @param {reqCommandInfo} reqCmdInfo
   */
  executeScenarioControl(reqCmdInfo) {
    const { wrapCmdType, wrapCmdId } = reqCmdInfo;

    if (wrapCmdType === reqWCT.CANCEL) {
      return this.coreFacade.scenarioManager.cancelScenario(reqCmdInfo);
    }

    const existCmdStorage = this.cmdManager.getCmdStorage({
      wrapCmdId,
    });

    // 이미 존재하는 명령이라면 예외 처리
    if (existCmdStorage) {
      throw new Error(`${existCmdStorage.wrapCmdName} 명령은 존재합니다.`);
    }

    return this.coreFacade.scenarioManager.executeScenario(reqCmdInfo);
  }
}
module.exports = ManualCmdStrategy;
