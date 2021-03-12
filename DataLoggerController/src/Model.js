const _ = require('lodash');
const { BU, CU } = require('base-util-jh');

const Control = require('./Control');

class Model {
  /**
   * @param {Control} controller
   */
  constructor(controller) {
    this.controller = controller;
    this.nodeList = controller.nodeList;

    this.hasAvgStorage = false;

    /**
     * 평균 값을 구할 Node 장치 리스트
     * @type {string[]} node 장치들
     */
    this.avgNodeIdList = [];

    /** @type {requestCommandSet[]} */
    this.requestCommandSetList = [];

    // 데이터 일부분의 들어올 경우 최종 합산처리하기 까지 담아놀 저장소. 기본 값은 ProtocolConverter에 BASE_MODEL
    // converter.BaseModel 은 요청할때마다 deepClone 한 객체. --> 데이터 형태만 정의된 객체
    this.tempStorage = controller.converter.BaseModel;
  }

  /**
   * 저장소를 깨끗이 비우고 현재 값을 초기화 시킴 Data 초기화
   */
  initModel() {
    // nodeList를 돌면서 데이터를 undefined 처리함

    this.nodeList.forEach(nodeInfo => {
      delete nodeInfo.data;
    });

    this.tempStorage = this.controller.converter.BaseModel;

    this.requestCommandSetList = [];

    if (this.hasAvgStorage) {
      this.averageStorage.init();
    }
  }

  /**
   * @desc Node 용
   * 평균 값 도출 기능을 사용하고자 할 경우
   * @param {nodeInfo[]} nodeList
   * @param {boolean=} hasCenterAvg 중앙 값 사용 여부. 기본 값 false
   */
  bindingAverageStorageForNode(nodeList, hasCenterAvg = false) {
    this.avgNodeIdList = _.map(nodeList, 'node_id');
    this.hasAvgStorage = true;
    const averConfig = {
      maxStorageNumber: 60, // 최대 저장 데이터 수
      keyList: this.avgNodeIdList,
    };

    this.averageStorage = new CU.AverageStorage(averConfig);
    this.averageStorage.hasCenterAverage = hasCenterAvg;
  }

  /**
   * requestCommandSet 저장
   * @param {requestCommandSet} requestCommandSet
   */
  addRequestCommandSet(requestCommandSet) {
    this.requestCommandSetList.push(requestCommandSet);
  }

  /**
   * 완료된 requestCommandSet 삭제
   * UUID 값이 있을 경우에는 uuid, commandId 비교. 없을 경우에는 commandId만 비교
   * @desc 정상적으로 완료했든, 에러 처리됐든 삭제
   * @param {requestCommandSet} requestCommandSet
   */
  completeRequestCommandSet(requestCommandSet) {
    // BU.CLIN(requestCommandSet);
    const compareInfo = {
      commandId: requestCommandSet.commandId,
    };
    // uuid 있을 경우 추가
    if (_.get(requestCommandSet, 'uuid', '').length) {
      compareInfo.uuid = requestCommandSet.uuid;
    }
    // 비교 조건과 같은 requestCommandSet 제거 후 남은 List 반환
    return _.remove(this.requestCommandSetList, requestCommand =>
      _(requestCommand).pick(_.keys(compareInfo)).isEqual(compareInfo),
    );
  }

  /**
   * NodeList와 부합되는 곳에 데이터를 정의
   * @param {Object} receiveData
   * @return {nodeInfo[]} 갱신된 노드
   */
  onData(receiveData) {
    /** @type {nodeInfo[]} */
    const renewalNodeList = [];
    _.forEach(this.nodeList, nodeInfo => {
      // Node Class와 매칭되는 데이터 리스트를 가져옴
      const dataList = _.get(receiveData, nodeInfo.nd_target_id, []);
      // Node에서 사용하는 Index와 매칭되는 dataList를 가져옴
      let data = _.nth(dataList, nodeInfo.data_logger_index);

      // 만약 해당 값이 존재하지 않는다면 갱신하지 않음.
      // 평균 값 추적 중인 데이터 일 경우 평균 값 도출 메소드 사용
      if (this.hasAvgStorage && _.includes(this.avgNodeIdList, nodeInfo.node_id)) {
        data = this.averageStorage
          .addData(nodeInfo.node_id, data)
          .getAverage(nodeInfo.node_id);
      }

      // 데이터가 같지 않은 경우 갱신 데이터로 처리
      if (!_.isEqual(nodeInfo.data, data)) {
        _.set(nodeInfo, 'data', data);
        // 갱신 리스트에 노드 삽입
        renewalNodeList.push(nodeInfo);
      }
      // 날짜는 항상 갱신
      _.set(nodeInfo, 'writeDate', new Date());
    });

    return renewalNodeList;
  }

  /**
   * 장치에 대한 명령을 2번이상 요청할 경우 데이터 갱신 오류가 발생되기 때문에 최종 데이터 합산을 하기 위한 메소드
   * @param {Object} receiveData 일부분의 데이터만 수신되었을 경우
   */
  onPartData(receiveData) {
    // 수신받은 데이터 객체 탐색
    _.forEach(receiveData, (dataList, nodeDefId) => {
      // 데이터 목록 중 의미있는 데이터가 있다면 기존 데이터에 덮어쓰기 함
      _.forEach(dataList, (data, index) => {
        if (!_.isNil(data)) {
          _.set(this.tempStorage, `${nodeDefId}[${index}]`, data);
        }
      });
    });
  }

  /** 장치에 대한 명령을 완료하고 임시 저장소에 있는 데이터를 반영할 경우 */
  completeOnData() {
    // 갱신된 Node 목록
    const renewalNodeList = this.onData(this.tempStorage);
    // 임시 저장소를 다시 초기화
    this.tempStorage = this.controller.converter.BaseModel;
    return renewalNodeList;
  }

  // completeOnData2() {
  //   // 갱신된 Node 목록
  //   const renewalNodeList = this.onData(this.tempStorage);
  //   // 임시 저장소를 다시 초기화
  //   this.tempStorage = this.controller.converter.BaseModel;

  //   renewalNodeList.forEach((nodeInfo) => {
  //     const { node_id: ni, data } = nodeInfo;

  //     let addValue = 0;

  //     switch (ni) {
  //       case 'WL_009':
  //         addValue = 0.7;
  //         break;
  //       case 'WL_010':
  //         addValue = 0.2;
  //         break;
  //       case 'WL_011':
  //         addValue = -0.5;
  //         break;
  //       // case 'WL_012':
  //       //   addValue = 0.2;
  //       //   break;
  //       case 'WL_015':
  //         addValue = -0.2;
  //         break;
  //       case 'WL_016':
  //         addValue = 0.2;
  //         break;

  //       default:
  //         break;
  //     }

  //     if (_.isNumber(data)) {
  //       const calcData = _.round(_.sum([addValue, data]), 1);

  //       if (calcData < 0) {
  //         nodeInfo.data = 0;
  //       } else {
  //         nodeInfo.data = calcData;
  //       }
  //     }
  //   });

  //   return renewalNodeList;
  // }
}

module.exports = Model;
