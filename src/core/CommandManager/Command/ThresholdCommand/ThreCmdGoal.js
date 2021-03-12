const _ = require('lodash');

const {
  di: {
    dcmConfigModel: { goalDataRange: goalDR },
  },
} = require('../../../../module');

const ThreCmdComponent = require('./ThreCmdComponent');

/**
 * 명령 달성 목표가 생성될 때 마다 객체를 생성.
 * 임계치 관리 저장소. Storage > Goal 순으로 Tree 구조를 가짐
 * 데이터가 갱신될 때 마다 해당 달성 목표가 처리 되었는지 확인.
 * 달성 목표를 완료하였거나 Timer의 동작이 진행되면 Successor에게 전파
 */
class ThreCmdGoal extends ThreCmdComponent {
  /**
   *
   * @param {CoreFacade} coreFacade
   * @param {csCmdGoalInfo} csCmdGoalInfo
   */
  constructor(coreFacade, csCmdGoalInfo) {
    super();
    const {
      nodeId = '',
      goalValue,
      goalRange,
      groupId = '',
      isInclusionGoal = 0,
      isCompleteClear = false,
      expressInfo: { expression = '', nodeList = [] } = {},
    } = csCmdGoalInfo;

    this.coreFacade = coreFacade;
    // 임계치 모니터링 Node 객체 Id
    this.nodeId = nodeId;
    // 달성 목표 데이터
    this.goalValue = goalValue;
    // 달성 목표 범위(LOWER, EQUAL, UPPER)
    this.goalRange = goalRange;
    // 임계치를 확인하는 그룹
    this.groupId = groupId;
    // 달성 목표 데이터 포함 여부.
    this.isInclusionGoal = isInclusionGoal;
    // 이 달성 목표만 성공하면 모든 조건 클리어 여부
    this.isCompleteClear = isCompleteClear;

    // 동적 표현식 메소드 생성
    // eslint-disable-next-line no-new-func
    this.expressionFn = new Function(...nodeList, `return ${expression}`);

    this.nodeInfo = nodeId.length ? coreFacade.getNodeInfo(nodeId) : {};

    this.nodeList = nodeList.length
      ? nodeList.map(expNodeId => coreFacade.getNodeInfo(expNodeId))
      : [];
  }

  /**
   * @param {CoreFacade} coreFacade
   * @param {csCmdGoalInfo} goalInfo 목표치 정보
   */
  static isReachGoal(coreFacade, goalInfo) {
    // BU.log('@@', goalInfo);
    const {
      nodeId,
      goalValue,
      goalRange,
      isInclusionGoal = 0,
      expressInfo: { expression = '', nodeList = [] } = {},
    } = goalInfo;

    let goalData;
    // 표현식을 사용할경우 우선
    if (expression.length) {
      // eslint-disable-next-line no-new-func
      const expressionFn = new Function(...nodeList, `return ${expression}`);
      const expressionDataList = _.map(
        nodeList,
        expressionNodeId => coreFacade.getNodeInfo(expressionNodeId).data,
      );

      goalData = expressionFn(...expressionDataList);
    } else {
      goalData = coreFacade.getNodeInfo(nodeId).data;
    }

    let isReach = false;

    switch (goalRange) {
      case goalDR.EQUAL:
        isReach = goalData === goalValue;
        break;
      case goalDR.LOWER:
        isReach = isInclusionGoal ? goalData <= goalValue : goalData < goalValue;
        break;
      case goalDR.UPPER:
        isReach = isInclusionGoal ? goalData >= goalValue : goalData > goalValue;
        break;
      default:
        break;
    }

    return isReach;
  }

  /**
   * 저장소에 연결된 임계치 목표 객체 Node ID 반환
   * @return {string} nodeId
   */
  get threCmdGoalId() {
    return this.nodeId;
  }

  // 달성 목표 성공 여부
  /**
   * @return {boolean} 목표 달성 시 ture, 실패 시 false
   */
  get isClear() {
    let isClear = false;

    // 표현식이 존재할 경우
    if (this.nodeList.length) {
      isClear = this.isReachExpression();
    } else {
      const { data } = this.nodeInfo;
      if (_.isNumber(data)) {
        isClear = this.isReachNumGoal(data);
      } else if (_.isString(data)) {
        isClear = this.isReachStrGoal(data);
      } else if (data === undefined) {
        isClear = goalDR.EQUAL === this.goalRange && this.goalValue === data;
      }
    }

    return isClear;
  }

  /**
   * Goal을 성공하였을 경우 알릴 Successor
   * @param {CmdComponent} thresholdStorage Threshold Command Storage
   */
  setSuccessor(thresholdStorage) {
    this.thresholdStorage = thresholdStorage;
  }

  /**
   * @return {boolean} 임계 명령 완료 여부
   */
  isThreCmdClear() {
    return this.thresholdStorage.isThreCmdClear();
  }

  /**
   * Critical Manager에서 업데이트된 Node 정보를 전달해옴.
   * 데이터가 달성 목표에 도달하였다면 Critical Stroage에 알림.
   * @param {nodeInfo} nodeInfo
   */
  updateNode(nodeInfo) {
    return this.thresholdStorage.handleThresholdClear(this);
  }

  /** 표현식으로 임계치를 체크할 경우 */
  isReachExpression() {
    return this.expressionFn(..._.map(this.nodeList, 'data'));
  }

  /**
   * @param {number} deviceData number 형식 데이터
   */
  isReachNumGoal(deviceData) {
    let isClear = false;

    switch (this.goalRange) {
      case goalDR.EQUAL:
        isClear = deviceData === this.goalValue;
        break;
      case goalDR.LOWER:
        isClear = this.isInclusionGoal
          ? deviceData <= this.goalValue
          : deviceData < this.goalValue;
        break;
      case goalDR.UPPER:
        isClear = this.isInclusionGoal
          ? deviceData >= this.goalValue
          : deviceData > this.goalValue;
        break;
      default:
        break;
    }

    return isClear;
  }

  /**
   * @param {string} deviceData string 형식 데이터
   */
  isReachStrGoal(deviceData) {
    // 문자 데이터일 경우에는 달성 목표가 EQUAL이어야만 함. 문자 상하 비교 불가
    if (this.goalRange !== goalDR.EQUAL) return false;

    // 대소 문자의 차이가 있을 수 있으므로 소문자로 변환 후 비교
    return _.lowerCase(deviceData) === _.lowerCase(this.goalValue);
  }
}
module.exports = ThreCmdGoal;
