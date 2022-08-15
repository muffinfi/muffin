import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { defaultAbiCoder } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { Lens, Manager, MockERC20 } from '../../typechain';
import { MAX_TICK, MIN_TICK } from '../shared/constants';
import { managerFixture } from '../shared/fixtures';
import { deploy } from '../shared/utils';

const parseTickData = (tickData: string) => {
  type Tick = [number, BigNumber, BigNumber, boolean, boolean] & {
    tickIdx: number;
    liquidityLowerD8: BigNumber;
    liquidityUpperD8: BigNumber;
    needSettle0: boolean;
    needSettle1: boolean;
  };
  const words = tickData.replace(/^0x/, '').match(/.{1,64}/g);
  if (words == null) return [] as Tick[];
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
      ) as Tick;
    });
};

describe('tick lens', () => {
  let token0: MockERC20;
  let token1: MockERC20;
  let poolId01: string;
  let user: SignerWithAddress;
  let manager: Manager;
  let lens: Lens;

  beforeEach(async () => {
    ({ manager, token0, token1, poolId01, user } = await waffle.loadFixture(managerFixture));
    lens = (await deploy('Lens', manager.address)) as Lens;
  });

  const batchMint = async (tickUppers: number[]) => {
    const calldatas = tickUppers.map((tickUpper) =>
      manager.interface.encodeFunctionData('mint', [
        {
          tierId: 0,
          token0: token0.address,
          token1: token1.address,
          amount0Desired: 25600,
          amount1Desired: 25600,
          amount0Min: 0,
          amount1Min: 0,
          recipient: user.address,
          useAccount: false,
          tickLower: 0,
          tickUpper,
        },
      ]),
    );
    await manager.multicall(calldatas);
  };

  beforeEach(async () => {
    await batchMint([1, 2, 3, 4, 5]);
  });

  const MAX_TICK_COUNT = MAX_TICK - MIN_TICK;

  it('all ticks', async () => {
    const result = await lens.getTicks(poolId01, 0, MIN_TICK, MAX_TICK, MAX_TICK_COUNT);
    const ticks = parseTickData(result.ticks);

    expect(ticks.length).eq(result.count);
    expect(ticks.length).eq(8); // [MIN_TICK, 0, 1, 2, 3, 4, 5, MAX_TICK]

    const expectedTicks = [MIN_TICK, 0, 1, 2, 3, 4, 5, MAX_TICK];
    ticks.forEach((tick, i) => expect(tick.tickIdx).eq(expectedTicks[i]));
  });

  it('max tick number', async () => {
    const result = await lens.getTicks(poolId01, 0, 0, 3, MAX_TICK_COUNT);
    const ticks = parseTickData(result.ticks);

    expect(ticks.length).eq(result.count);
    expect(ticks.length).eq(4); // [0, 1, 2, 3]

    expect(ticks[0].tickIdx).eq(0);
    expect(ticks[1].tickIdx).eq(1);
    expect(ticks[2].tickIdx).eq(2);
    expect(ticks[3].tickIdx).eq(3);
  });

  it('max tick count', async () => {
    const result = await lens.getTicks(poolId01, 0, 0, MAX_TICK, 4);
    const ticks = parseTickData(result.ticks);

    expect(ticks.length).eq(result.count);
    expect(ticks.length).eq(4); // [0, 1, 2, 3]

    expect(ticks[0].tickIdx).eq(0);
    expect(ticks[1].tickIdx).eq(1);
    expect(ticks[2].tickIdx).eq(2);
    expect(ticks[3].tickIdx).eq(3);
  });

  it('not initialized start tick', async () => {
    const result = await lens.getTicks(poolId01, 0, 100, MAX_TICK, MAX_TICK_COUNT);
    const ticks = parseTickData(result.ticks);

    expect(ticks.length).eq(result.count);
    expect(ticks.length).eq(0);
  });
});
