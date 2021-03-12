const _ = require('lodash');

const { BU } = require('base-util-jh');

const AlgorithmComponent = require('./AlgorithmComponent');
const PlaceThreshold = require('./PlaceThreshold');

const {
  dcmConfigModel: { cmdStrategyType, placeNodeStatus: nodeStatus },
} = require('../../module').di;

/** @description 3 Depth. 구동 모드를 운영하는 객체 */
class AlgorithmMode extends AlgorithmComponent {
  /** @param {CoreFacade} coreFacade */
  constructor(coreFacade) {
    super();
    this.coreFacade = coreFacade;

    /** @type {operationConfig} */
    this.operationModeInfo = {
      algorithmId: 'DEFAULT',
      algorithmName: '기본',
      cmdStrategy: cmdStrategyType.MANUAL,
    };

    /** @type {PlaceThreshold[]} */
    this.threPlaceList = [];
  }

  /** @return {operationConfig} 구동 모드 알고리즘 설정 정보 */
  getOperationConfig() {
    return this.operationModeInfo;
  }

  /**
   * 현재 구동 모드 알고리즘 ID 가져옴
   * @return {string} Algorithm Id
   */
  get algorithmId() {
    return this.operationModeInfo.algorithmId;
  }

  /**
   * 현재 구동 모드 알고리즘 Name 가져옴
   * @return {string} Algorithm Name
   */
  get algorithmName() {
    return this.operationModeInfo.algorithmName;
  }

  /**
   * 현재 명령 전략 가져옴
   * @return {string} cmdStrategy
   */
  get cmdStrategy() {
    return this.operationModeInfo.cmdStrategy;
  }

  /**
   * 노드 데이터 갱신
   * @param {PlaceNode} placeNode 데이터 갱신이 발생한 노드
   */
  handleUpdateNode(placeNode) {
    const threAlgorithm = _.find(this.threPlaceList, {
      nodeDefId: placeNode.getNodeDefId(),
    });

    if (_.isEmpty(threAlgorithm)) {
      // BU.CLI(`알고리즘 없음 ${this.threPlaceList.length}`, placeNode.getNodeDefId());
      return false;
    }

    let selectedAlgorithmMethod = threAlgorithm.handleNormal;

    switch (placeNode.getNodeStatus()) {
      case nodeStatus.MAX_OVER:
        selectedAlgorithmMethod = threAlgorithm.handleMaxOver;
        break;
      case nodeStatus.UPPER_LIMIT_OVER:
        selectedAlgorithmMethod = threAlgorithm.handleUpperLimitOver;
        break;
      case nodeStatus.NORMAL:
        selectedAlgorithmMethod = threAlgorithm.handleNormal;
        break;
      case nodeStatus.LOWER_LIMIT_UNDER:
        selectedAlgorithmMethod = threAlgorithm.handleLowerLimitUnder;
        break;
      case nodeStatus.MIN_UNDER:
        selectedAlgorithmMethod = threAlgorithm.handleMinUnder;
        break;
      case nodeStatus.UNKNOWN:
        selectedAlgorithmMethod = threAlgorithm.handleUnknown;
        break;
      case nodeStatus.ERROR:
        selectedAlgorithmMethod = threAlgorithm.handleError;
        break;
      default:
        selectedAlgorithmMethod = threAlgorithm.handleNormal;
        break;
    }
    // 임계치에 맞는 메소드 호출. (this 인자를 잃으므로 지정 처리)
    selectedAlgorithmMethod.call(threAlgorithm, placeNode);
  }
}
module.exports = AlgorithmMode;
