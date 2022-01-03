import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers, waffle } from 'hardhat';
import { Engine, MockCaller, MockERC20 } from '../typechain';
import { rawEngineFixture } from './shared/fixtures';
import { bn, gasUsed, getLatestBlockTimestamp, setNextBlockTimestamp } from './shared/utils';

import fs from 'fs';
import path from 'path';

const arr = (start: number, end: number) =>
  Array(end - start + 1)
    .fill(0)
    .map((_, i) => i + start);

const ACCOUNT_ID = 1;
const TICK_CROSS = -300;
const TIER_COUNT_ARR = arr(1, 6);

describe('swap gas: ', () => {
  let stream: fs.WriteStream;

  before('create log file write stream', () => {
    const dirpath = path.join(__dirname, '__reports__');
    const filepath = path.join(__dirname, '__reports__/swap_gas.report');
    if (!fs.existsSync(dirpath)) fs.mkdirSync(dirpath);
    stream = fs.createWriteStream(filepath, { flags: 'w' });
  });

  after('close log file write stream', () => {
    stream.end();
  });

  const logToFile = (message: string) => {
    stream.write(`${message}\n`);
  };

  const fixtureFactory = (tierCount: number) => async () => {
    const fixture = await rawEngineFixture();
    const { token0, token1, engine, user, caller } = fixture;

    // make 5 tiers
    await caller.createPool(engine.address, token0.address, token1.address, '99999', bn(1).shl(72), ACCOUNT_ID);
    for (let i = 1; i < tierCount; i++) await engine.addTier(token0.address, token1.address, 99999, ACCOUNT_ID);

    // initialize reward growth global
    await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 10);
    await engine.burn({
      token0: token0.address,
      token1: token1.address,
      tierId: 0,
      tickLower: 0,
      tickUpper: 1,
      pid: 0,
      liquidity: 0,
      recipient: user.address,
      recipientAccId: 0,
    });

    // mint positions
    for (let i = 0; i < tierCount; i++) {
      await caller.mint(engine.address, {
        token0: token0.address,
        token1: token1.address,
        tierId: i,
        tickLower: TICK_CROSS,
        tickUpper: 300,
        pid: 0,
        liquidity: 1,
        senderAccId: 1,
        recipient: caller.address,
        data: [],
      });
    }

    // initialize fee growth global and tick states
    const swapArgs = {
      token0: token0.address,
      token1: token1.address,
      recipient: user.address,
      isToken0: true,
      amountDesired: 300 * tierCount,
      tierChoices: 0b111111,
      senderAccId: 1,
      recipientAccId: 0,
      data: [],
    };
    await caller.swap(engine.address, { ...swapArgs, amountDesired: 300 * tierCount });
    await caller.swap(engine.address, { ...swapArgs, amountDesired: -295 * tierCount });

    return fixture;
  };

  for (const tierCount of TIER_COUNT_ARR) {
    context(`${tierCount}-tier pool: `, () => {
      let token0: MockERC20;
      let token1: MockERC20;
      let engine: Engine;
      let caller: MockCaller;
      let user: SignerWithAddress;

      const getPoolId = () => {
        return ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]),
        );
      };
      const getTier = async (tierId: number) => {
        return await engine.getTier(getPoolId(), tierId);
      };
      const getTick = async (tierId: number, tickNum: number) => {
        return await engine.getTick(getPoolId(), tierId, tickNum);
      };
      const checkTicksGt = async (tick: number) => {
        for (let i = 0; i < tierCount; i++) expect((await getTier(i)).tick).gt(tick);
      };
      const checkTicksLt = async (tick: number) => {
        for (let i = 0; i < tierCount; i++) expect((await getTier(i)).tick).lt(tick);
      };
      const makeFixture = fixtureFactory(tierCount);

      beforeEach(async () => {
        ({ token0, token1, engine, user, caller } = await waffle.loadFixture(makeFixture));

        // check states are initialized
        await checkTicksGt(TICK_CROSS);
        // expect(await pool.rewardGrowthGlobal()).gt(0);
        for (let i = 0; i < tierCount; i++) {
          const tier = await getTier(i);
          expect(tier.feeGrowthGlobal0).gt(0);
          expect(tier.feeGrowthGlobal1).gt(0);
          const tick = await getTick(i, TICK_CROSS);
          expect(tick.feeGrowthOutside0).gt(0);
          expect(tick.feeGrowthOutside1).gt(0);
        }
      });

      for (const routeCount of arr(1, tierCount)) {
        context(`route to ${routeCount} tiers: `, () => {
          const swap = async (amtDesired: number, tierChoices: number = 0b111111) => {
            await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 60 * 15); // 15 min per swap
            return await caller.swap(engine.address, {
              token0: token0.address,
              token1: token1.address,
              recipient: user.address,
              isToken0: true,
              amountDesired: amtDesired,
              tierChoices,
              senderAccId: 1,
              recipientAccId: 1,
              data: [],
            });
          };

          beforeEach(async () => {
            if (tierCount == routeCount) return;
            await swap(100_000_000_000, (0b111111 << routeCount) & 0b111111);
          });

          for (const crossCount of arr(0, routeCount)) {
            it(`${crossCount} tiers crossing a tick: `, async () => {
              for (let i = 0; i < routeCount - crossCount; i++) {
                await caller.burn(engine.address, {
                  token0: token0.address,
                  token1: token1.address,
                  tierId: i,
                  tickLower: TICK_CROSS,
                  tickUpper: 300,
                  pid: 0,
                  liquidity: 1,
                  recipient: user.address,
                  recipientAccId: 0,
                });
              }

              const tx = await swap(300 * routeCount);
              await checkTicksLt(TICK_CROSS);
              // expect(await gasUsed(tx)).toMatchSnapshot();
              logToFile(
                `${tierCount}-tier pool: route to ${routeCount} tiers: ${crossCount} tiers crossing a tick: ${await gasUsed(tx)}`,
              );
            });
          }
        });
      }
    });
  }
});
