const _ = require('lodash');

const AlgorithmComponent = require('./AlgorithmComponent');

/** 2 Depth */
class AlgorithmStorage extends AlgorithmComponent {
  /** @param {CoreFacade} coreFacade */
  constructor(coreFacade) {
    super();
    this.coreFacade = coreFacade;
    /** @type {AlgorithmComponent[]} 알고리즘 모드 객체 목록 */
    this.algorithmModeList = [];
    /** @type {AlgorithmComponent} 실행 중인 알고리즘 모드 객체 */
    this.algorithmMode = {};
  }

  /**
   * @param {string} algorithmId
   * @return {operationConfig} 구동 모드 알고리즘 설정 정보
   */
  getOperationConfig(algorithmId) {
    if (_.isNil(algorithmId) || algorithmId.length === 0) {
      return this.algorithmMode.getOperationConfig();
    }
    return this.getOperationMode(algorithmId).getOperationConfig();
  }

  /** @return {operationConfig[]} 구동 모드 알고리즘 설정 정보 목록 */
  getOperationConfigList() {
    return _.map(this.algorithmModeList, 'operationModeInfo');
  }

  /**
   * 현재 구동 모드 알고리즘 ID 가져옴
   * @return {string} Algorithm Id
   */
  get algorithmId() {
    return this.algorithmMode.algorithmId;
  }

  /**
   * 현재 구동 모드 알고리즘 Name 가져옴
   * @return {string} Algorithm Name
   */
  get algorithmName() {
    return this.algorithmMode.algorithmName;
  }

  /**
   * 현재 명령 전략 가져옴
   * @return {string} cmdStrategy
   */
  get cmdStrategy() {
    return this.algorithmMode.cmdStrategy;
  }

  /**
   * 구동 모드 객체를 추가함
   * @param {AlgorithmComponent} algorithmMode
   */
  addOperationMode(algorithmMode) {
    // 삽입 후 true 반환
    return this.algorithmModeList.push(algorithmMode) && true;
  }

  /**
   * 구동 모드를 알고리즘 Id로 찾아와서 반환
   * @param {string} algorithmId
   * @return {AlgorithmComponent}
   */
  getOperationMode(algorithmId) {
    return _.find(
      this.algorithmModeList,
      operationMode => operationMode.algorithmId === algorithmId,
    );
  }

  /**
   * 구동 모드를 변경할 경우(Api Server에서 요청)
   * @param {string} algorithmId 제어 모드
   */
  changeOperationMode(algorithmId = 'DEFAULT') {
    // 구동 모드 객체를 가져옴
    const operationMode = this.getOperationMode(algorithmId);

    // 구동 모드가 존재하지 않을 경우
    if (_.isEmpty(operationMode)) {
      throw new Error(`algorithmId: (${algorithmId}) is not exist.`);
    }
    // 구동 모드가 동일 할 경우
    if (operationMode === this.algorithmMode) {
      throw new Error(`algorithmId: (${algorithmId}) is the same operation mode.`);
    }

    // 구동 모드 변경
    this.algorithmMode = operationMode;

    // 명령 알고리즘 모드 교체
    this.coreFacade.cmdManager.updateOperationMode(operationMode);

    return true;
  }

  /**
   * 노드 데이터 갱신
   * @param {CoreFacade} coreFacade Place Manager
   * @param {placeManager} placeManager Place Manager
   * @param {PlaceComponent} placeNode 데이터 갱신이 발생한 노드
   */
  handleUpdateNode(placeNode) {
    this.algorithmMode.handleUpdateNode(placeNode);
  }

  handleCompleteMeasureScheduler() {
    this.algorithmMode.handleCompleteMeasureScheduler();
  }
}

module.exports = AlgorithmStorage;
