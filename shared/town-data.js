/* Math Quest — the pieces for his town (Kenney city, survival and road kits, CC0).
   `earned`: one comes with each finished round (washed clean on the result card), in this order.
   `free`: roads, trees and decorations he can always place. `size` is the footprint in town tiles. */
(function (root) {
  'use strict';
  const TOWN = {
    earned: [
      { id: 'tent', model: 'survival/tent-canvas', name: 'Tent', zh: '帐篷', size: 1 },
      { id: 'housea', model: 'suburban/building-type-a', name: 'House', zh: '房子', size: 2 },
      { id: 'shopa', model: 'commercial/building-a', name: 'Big building', zh: '大楼', size: 2 },
      { id: 'campfire', model: 'survival/campfire-pit', name: 'Campfire', zh: '篝火', size: 1 },
      { id: 'houseb', model: 'suburban/building-type-b', name: 'House', zh: '房子', size: 2 },
      { id: 'shopb', model: 'commercial/building-b', name: 'Big building', zh: '大楼', size: 2 },
      { id: 'housec', model: 'suburban/building-type-c', name: 'House', zh: '房子', size: 2 },
      { id: 'bench', model: 'survival/workbench', name: 'Workbench', zh: '工作台', size: 1 },
      { id: 'shopc', model: 'commercial/building-c', name: 'Big building', zh: '大楼', size: 2 },
      { id: 'housed', model: 'suburban/building-type-d', name: 'House', zh: '房子', size: 2 },
      { id: 'housee', model: 'suburban/building-type-e', name: 'House', zh: '房子', size: 2 },
      { id: 'shopd', model: 'commercial/building-d', name: 'Big building', zh: '大楼', size: 2 },
      { id: 'chest', model: 'survival/chest', name: 'Treasure chest', zh: '宝箱', size: 1 },
      { id: 'housef', model: 'suburban/building-type-f', name: 'House', zh: '房子', size: 2 },
      { id: 'shope', model: 'commercial/building-e', name: 'Big building', zh: '大楼', size: 2 },
      { id: 'houseg', model: 'suburban/building-type-g', name: 'House', zh: '房子', size: 2 },
      { id: 'shopf', model: 'commercial/building-f', name: 'Big building', zh: '大楼', size: 2 },
      { id: 'househ', model: 'suburban/building-type-h', name: 'House', zh: '房子', size: 2 },
      { id: 'housei', model: 'suburban/building-type-i', name: 'House', zh: '房子', size: 2 },
      { id: 'shopg', model: 'commercial/building-g', name: 'Big building', zh: '大楼', size: 2 },
      { id: 'sign', model: 'survival/signpost', name: 'Signpost', zh: '路牌', size: 1 },
      { id: 'housej', model: 'suburban/building-type-j', name: 'House', zh: '房子', size: 2 },
      { id: 'shoph', model: 'commercial/building-h', name: 'Big building', zh: '大楼', size: 2 },
      { id: 'housek', model: 'suburban/building-type-k', name: 'House', zh: '房子', size: 2 },
      { id: 'barrel', model: 'survival/barrel', name: 'Barrel', zh: '木桶', size: 1 },
      { id: 'housel', model: 'suburban/building-type-l', name: 'House', zh: '房子', size: 2 },
      { id: 'bedroll', model: 'survival/bedroll', name: 'Sleeping bag', zh: '睡袋', size: 1 },
      { id: 'housem', model: 'suburban/building-type-m', name: 'House', zh: '房子', size: 2 },
      { id: 'bigfish', model: 'survival/fish-large', name: 'Big fish', zh: '大鱼', size: 1 },
      { id: 'housen', model: 'suburban/building-type-n', name: 'House', zh: '房子', size: 2 },
      { id: 'houseo', model: 'suburban/building-type-o', name: 'House', zh: '房子', size: 2 },
      { id: 'housep', model: 'suburban/building-type-p', name: 'House', zh: '房子', size: 2 },
      { id: 'houseq', model: 'suburban/building-type-q', name: 'House', zh: '房子', size: 2 },
      { id: 'houser', model: 'suburban/building-type-r', name: 'House', zh: '房子', size: 2 },
      { id: 'houses', model: 'suburban/building-type-s', name: 'House', zh: '房子', size: 2 },
      { id: 'houset', model: 'suburban/building-type-t', name: 'House', zh: '房子', size: 2 },
      { id: 'houseu', model: 'suburban/building-type-u', name: 'House', zh: '房子', size: 2 },
    ],
    free: [
      { id: 'road', model: 'roads/road-straight', name: 'Road', zh: '路', size: 1 },
      { id: 'bend', model: 'roads/road-bend', name: 'Road bend', zh: '弯路', size: 1 },
      { id: 'cross', model: 'roads/road-crossroad', name: 'Crossroad', zh: '十字路口', size: 1 },
      { id: 'tjunct', model: 'roads/road-intersection', name: 'T road', zh: '丁字路口', size: 1 },
      { id: 'roadend', model: 'roads/road-end-round', name: 'Road end', zh: '路尽头', size: 1 },
      { id: 'lamp', model: 'roads/light-square', name: 'Street light', zh: '路灯', size: 1 },
      { id: 'tree', model: 'suburban/tree-large', name: 'Tree', zh: '大树', size: 1 },
      { id: 'treesm', model: 'suburban/tree-small', name: 'Small tree', zh: '小树', size: 1 },
      { id: 'autumn', model: 'survival/tree-autumn', name: 'Autumn tree', zh: '秋天的树', size: 1 },
      { id: 'pine', model: 'survival/tree-tall', name: 'Tall tree', zh: '高树', size: 1 },
      { id: 'planter', model: 'suburban/planter', name: 'Flowers', zh: '花坛', size: 1 },
      { id: 'fence', model: 'suburban/fence-1x2', name: 'Fence', zh: '栅栏', size: 1 },
      { id: 'rock', model: 'survival/rock-a', name: 'Rock', zh: '石头', size: 1 },
      { id: 'path', model: 'suburban/path-stones-short', name: 'Stone path', zh: '石头路', size: 1 },
      { id: 'wood', model: 'survival/resource-wood', name: 'Wood pile', zh: '木头堆', size: 1 },
    ],
  };
  // Pieces he has earned so far: one per finished round in any game (rounds are already saved).
  TOWN.roundsDone = (data) => Object.values((data && data.games) || {}).reduce((s, g) => s + (Number(g && g.played) || 0), 0);
  TOWN.earnedFor = (data) => TOWN.earned.slice(0, Math.min(TOWN.earned.length, TOWN.roundsDone(data)));
  TOWN.next = (data) => TOWN.earned[TOWN.roundsDone(data) % TOWN.earned.length];
  if (typeof module !== 'undefined' && module.exports) module.exports = TOWN;
  if (root.MQ) root.MQ.TOWN = TOWN;
})(typeof window !== 'undefined' ? window : globalThis);
