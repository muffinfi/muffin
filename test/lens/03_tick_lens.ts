import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { defaultAbiCoder } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { Lens, Manager } from '../../typechain';
import { LimitOrderType, MAX_TICK, MIN_TICK } from '../shared/constants';
import { managerFixture } from '../shared/fixtures';
import { deploy } from '../shared/utils';

type ParsedTick = [number, BigNumber, BigNumber, boolean, boolean] & {
  tickIdx: number;
  liquidityLowerD8: BigNumber;
  liquidityUpperD8: BigNumber;
  needSettle0: boolean;
  needSettle1: boolean;
};
const parseTickData = (tickData: string) => {
  const words = tickData.replace(/^0x/, '').match(/.{1,64}/g);
  if (words == null) return [] as ParsedTick[];
  return words
    .map((word) => [
      word.slice(0 / 4, 24 / 4), //     int24   tickIdx
      word.slice(24 / 4, 120 / 4), //   uint96  liquidityLowerD8
      word.slice(120 / 4, 216 / 4), //  uint96  liquidityUpperD8
      word.slice(216 / 4, 224 / 4), //  bool    needSettle0
      word.slice(224 / 4, 232 / 4), //  bool    needSettle1
    ])
    .map((sliced) => {
      return defaultAbiCoder.decode(
        [
          'int24 tickIdx', //
          'uint96 liquidityLowerD8',
          'uint96 liquidityUpperD8',
          'bool needSettle0',
          'bool needSettle1',
        ],
        '0x' + sliced.map((x) => x.padStart(64, '0')).join(''),
      ) as ParsedTick;
    });
};

describe('tick lens', () => {
  let poolId01: string;
  let manager: Manager;
  let lens: Lens;

  beforeEach(async () => {
    const fixture = await waffle.loadFixture(managerFixture);
    ({ manager, poolId01 } = fixture);
    lens = (await deploy('Lens', manager.address)) as Lens;

    // add liquidity and set limit orders
    const { token0, token1, user, caller, hub } = fixture;
    const mintParams = {
      token0: token0.address,
      token1: token1.address,
      tierId: 0,
      liquidityD8: 100000,
      recipient: user.address,
      positionRefId: 777,
      senderAccRefId: 1,
      data: [],
    };
    await caller.mint({ ...mintParams, tickLower: -100, tickUpper: 1 });
    await caller.mint({ ...mintParams, tickLower: -100, tickUpper: 2 });
    await caller.mint({ ...mintParams, tickLower: -100, tickUpper: 3 });
    await caller.mint({ ...mintParams, tickLower: 3, tickUpper: 4 });
    await hub.setLimitOrderType(token0.address, token1.address, 0, 3, 4, 777, LimitOrderType.ZERO_FOR_ONE);

    // add another tier
    await hub.addAccountBalance(user.address, 1, token0.address, 25600);
    await hub.addAccountBalance(user.address, 1, token1.address, 25600);
    await hub.setPoolAllowedSqrtGammas(poolId01, [99850, 99950]);
    await hub.addTier(token0.address, token1.address, 99950, 1);

    return fixture;
  });

  // prettier-ignore
  const expectedTicksOfTier0 = {
    [MIN_TICK]: { tickIdx: MIN_TICK, liquidityLowerD8: 100,         liquidityUpperD8: 0,        needSettle0: false, needSettle1: false },
    [-100]:     { tickIdx: -100,     liquidityLowerD8: 100_000 * 3, liquidityUpperD8: 0,        needSettle0: false, needSettle1: false },
    1:          { tickIdx: 1,        liquidityLowerD8: 0,           liquidityUpperD8: 100_000,  needSettle0: false, needSettle1: false },
    2:          { tickIdx: 2,        liquidityLowerD8: 0,           liquidityUpperD8: 100_000,  needSettle0: false, needSettle1: false },
    3:          { tickIdx: 3,        liquidityLowerD8: 100_000,     liquidityUpperD8: 100_000,  needSettle0: false, needSettle1: false },
    4:          { tickIdx: 4,        liquidityLowerD8: 0,           liquidityUpperD8: 100_000,  needSettle0: false, needSettle1: true  },
    [MAX_TICK]: { tickIdx: MAX_TICK, liquidityLowerD8: 0,           liquidityUpperD8: 100,      needSettle0: false, needSettle1: false },
  };

  const expectTickEquals = (tickParsed: ParsedTick, expectedTickId: number) => {
    const expectedTick = expectedTicksOfTier0[expectedTickId as keyof typeof expectedTicksOfTier0];
    expect(expectedTick).not.eq(undefined);
    expect(tickParsed.tickIdx).eq(expectedTick.tickIdx);
    expect(tickParsed.liquidityLowerD8).eq(expectedTick.liquidityLowerD8);
    expect(tickParsed.liquidityUpperD8).eq(expectedTick.liquidityUpperD8);
    expect(tickParsed.needSettle0).eq(expectedTick.needSettle0);
    expect(tickParsed.needSettle1).eq(expectedTick.needSettle1);
  };

  const MAX_TICK_COUNT = MAX_TICK - MIN_TICK;

  it('get all ticks', async () => {
    const result = await lens.getTicks(poolId01, 0, MIN_TICK, MAX_TICK, MAX_TICK_COUNT);
    const ticks = parseTickData(result.ticks);

    expect(ticks.length).eq(result.count);
    expect(ticks.length).eq(7);

    expectTickEquals(ticks[0], MIN_TICK);
    expectTickEquals(ticks[1], -100);
    expectTickEquals(ticks[2], 1);
    expectTickEquals(ticks[3], 2);
    expectTickEquals(ticks[4], 3);
    expectTickEquals(ticks[5], 4);
    expectTickEquals(ticks[6], MAX_TICK);
  });

  it('get all ticks (reversed direction)', async () => {
    const result = await lens.getTicks(poolId01, 0, MAX_TICK, MIN_TICK, MAX_TICK_COUNT);
    const ticks = parseTickData(result.ticks);

    expect(ticks.length).eq(result.count);
    expect(ticks.length).eq(7);

    expectTickEquals(ticks[0], MAX_TICK);
    expectTickEquals(ticks[1], 4);
    expectTickEquals(ticks[2], 3);
    expectTickEquals(ticks[3], 2);
    expectTickEquals(ticks[4], 1);
    expectTickEquals(ticks[5], -100);
    expectTickEquals(ticks[6], MIN_TICK);
  });

  it('set max tick number', async () => {
    const result = await lens.getTicks(poolId01, 0, 1, 4, MAX_TICK_COUNT);
    const ticks = parseTickData(result.ticks);

    expect(ticks.length).eq(result.count);
    expect(ticks.length).eq(4); // [1, 2, 3, 4]

    expectTickEquals(ticks[0], 1);
    expectTickEquals(ticks[1], 2);
    expectTickEquals(ticks[2], 3);
    expectTickEquals(ticks[3], 4);
  });

  it('set max tick count', async () => {
    const result = await lens.getTicks(poolId01, 0, 1, MAX_TICK, 4);
    const ticks = parseTickData(result.ticks);

    expect(ticks.length).eq(result.count);
    expect(ticks.length).eq(4); // [1, 2, 3, 4]

    expectTickEquals(ticks[0], 1);
    expectTickEquals(ticks[1], 2);
    expectTickEquals(ticks[2], 3);
    expectTickEquals(ticks[3], 4);
  });

  it('another tier id', async () => {
    const result = await lens.getTicks(poolId01, 1, MIN_TICK, MAX_TICK, MAX_TICK_COUNT);
    const ticks = parseTickData(result.ticks);
    expect(ticks.length).eq(result.count);
    expect(ticks.length).eq(2); // [MIN_TICK, MAX_TICK]

    expect(ticks[0].tickIdx).eq(MIN_TICK);
    expect(ticks[1].tickIdx).eq(MAX_TICK);
  });

  it('not initialized start tick', async () => {
    const result = await lens.getTicks(poolId01, 0, 100, MAX_TICK, MAX_TICK_COUNT);
    const ticks = parseTickData(result.ticks);

    expect(ticks.length).eq(result.count);
    expect(ticks.length).eq(0);
  });
});
