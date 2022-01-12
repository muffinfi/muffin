import chalk from 'chalk';
import { BigNumberish, ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import { Engine, MockCaller, MockERC20, Pools, WETH9 } from '../typechain';
import { bn, deployQuiet, logTxGas, wad } from './utils';

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

async function main() {
  console.log(chalk.cyan.bold('\n=============== main ==============='));
  const [me] = await ethers.getSigners();

  // ===== deploy tokens =====
  const tokenA = (await deployQuiet('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
  const tokenB = (await deployQuiet('MockERC20', 'BBB Token', 'BBB')) as MockERC20;
  const tokens = [tokenA, tokenB].sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));
  const [token0, token1] = tokens;

  // ===== deploy contracts =====
  const poolLib = (await deployQuiet('Pools')) as Pools;
  const Engine = await ethers.getContractFactory('Engine', { libraries: { Pools: poolLib.address } });

  const engine = (await deployQuiet(Engine)) as Engine;
  const caller = (await deployQuiet('MockCaller', engine.address)) as MockCaller;

  // ===== token approval =====
  for (const token of [token0, token1]) {
    await token.mint(wad('100_000_000_000'));
    await token.approve(engine.address, wad('100_000_000_000'));
    await token.approve(caller.address, wad('100_000_000_000'));
  }

  // ===== deposit tokens =====
  const accId = 1;
  await logTxGas(caller.deposit(caller.address, accId, token0.address, wad('100_000_000_000'), ''), 'deposit token0'); // prettier-ignore
  await logTxGas(caller.deposit(caller.address, accId, token1.address, wad('100_000_000_000'), ''), 'deposit token1'); // prettier-ignore
  await logTxGas(caller.deposit(me.address, accId, token0.address, wad('100_000_000_000'), ''), 'deposit token0 to me'); // prettier-ignore
  await logTxGas(caller.deposit(me.address, accId, token1.address, wad('100_000_000_000'), ''), 'deposit token1 to me'); // prettier-ignore

  // ===== create pool and add tiers =====
  const price = 3100.0;
  const sqrtP = bn(Math.floor(price ** 0.5 * 100_000_000)).shl(72).div(100_000_000); // prettier-ignore
  await logTxGas(caller.createPool(token0.address, token1.address, 99850, sqrtP, accId), 'create pool');
  await engine.addTier(token0.address, token1.address, 99750, accId); // add tier 50 bps
  await engine.addTier(token0.address, token1.address, 99925, accId); // add tier 15 bps
  await engine.addTier(token0.address, token1.address, 99975, accId); // add tier  5 bps
  await engine.addTier(token0.address, token1.address, 99990, accId); // add tier  2 bps

  const poolId = ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address])); // prettier-ignore
  await engine.setProtocolFee(poolId, Math.floor(0.15 * 255));
  await engine.setTickSpacing(poolId, 1);

  // ===== add liquidity =====
  const mintArgs = {
    token0: token0.address,
    token1: token1.address,
    recipient: caller.address,
    recipientAccId: 1,
    senderAccId: 0,
    data: [],
  };
  // await logTxGas(caller.mint(engine.address, mintArgs), 'add liq to tier #0');
  await logTxGas(caller.mint({ tierId: 0, tickLower: 73590, tickUpper: 84600, liquidityD8: wad('522_259').div(2**8), ...mintArgs }), 'add liq to tier #0'); // prettier-ignore
  await logTxGas(caller.mint({ tierId: 0, tickLower: 79980, tickUpper: 80430, liquidityD8: wad('522_259').div(2**8), ...mintArgs }), 'add liq to tier #0'); // prettier-ignore
  await logTxGas(caller.mint({ tierId: 1, tickLower: 73590, tickUpper: 84600, liquidityD8: wad('444_518').div(2**8), ...mintArgs }), 'add liq to tier #1'); // prettier-ignore
  await logTxGas(caller.mint({ tierId: 2, tickLower: 73590, tickUpper: 84600, liquidityD8: wad('744_518').div(2**8), ...mintArgs }), 'add liq to tier #2'); // prettier-ignore
  await logTxGas(caller.mint({ tierId: 3, tickLower: 73590, tickUpper: 84600, liquidityD8: wad('84_192').div(2**8), ...mintArgs }), 'add liq to tier #3'); // prettier-ignore
  await logTxGas(caller.mint({ tierId: 4, tickLower: 73590, tickUpper: 84600, liquidityD8: wad('200').div(2**8), ...mintArgs }), 'add liq to tier #4'); // prettier-ignore

  // ===== swap =====
  const wait = async () => {
    const ts = (await ethers.provider.getBlock('latest')).timestamp;
    await ethers.provider.send('evm_setNextBlockTimestamp', [ts + 60 * 15]);
  };

  const toPath = (tokens: (MockERC20 | WETH9)[]) => {
    const types = [];
    const values = [];
    for (const token of tokens) {
      types.push('address');
      types.push('uint8');
      values.push(token.address);
      values.push(0b111111);
    }
    types.pop();
    values.pop();
    return ethers.utils.solidityPack(types, values);
  };

  const swap = async (isToken0: boolean, amountDesired: BigNumberish, notes: string) => {
    const isToken0In = isToken0 == amountDesired > 0;
    const tokenIn = isToken0In ? token0.address : token1.address;
    const tokenOut = isToken0In ? token1.address : token0.address;

    await wait();
    await logTxGas(caller.swap(tokenIn, tokenOut, 0b111111, amountDesired, caller.address, 0, 0), notes);
    // await logTxGas(
    //   caller.swapHop(engine.address, {
    //     path: toPath([tokenIn, tokenOut]),
    //     amountDesired,
    //     recipient: caller.address,
    //     recipientAccId: 0,
    //     senderAccId: 0,
    //     data: [],
    //   }),
    //   notes,
    // );
  };

  await swap(true, wad('1000'), 'swap #1');
  await swap(false, wad('2_000_000'), 'swap #2');
  await swap(true, wad('200'), 'swap #3');
  await swap(false, wad('100_000'), 'swap #4');
  await swap(true, wad('10'), 'swap #5');
  await swap(true, wad('100'), 'swap #6');
  await swap(true, wad('300'), 'swap #7');

  const burnArgs = {
    token0: token0.address,
    token1: token1.address,
    accId: 1,
    collectAllFees: true,
  };
  await logTxGas(caller.burn({ tierId: 0, tickLower: 73590, tickUpper: 84600, liquidityD8: wad('522_259').div(2**8), ...burnArgs }), 'burn all liq from tier #0'); // prettier-ignore
  await logTxGas(caller.mint({ tierId: 0, tickLower: 73590, tickUpper: 84600, liquidityD8: wad('1_000_000').div(2**8), ...mintArgs }), 'add liq to tier #0'); // prettier-ignore
  await logTxGas(caller.mint({ tierId: 0, tickLower: 73590, tickUpper: 84600, liquidityD8: wad('1_000_000').div(2**8), ...mintArgs, recipientAccId: 2 }), 'add liq to tier #0'); // prettier-ignore
  // // ===== remove + collect and re-add liq =====
  // await logTxGas(manager.removeLiquidityAndCollect({ tokenId: 0, liquidity: wad('522_259'), amount0Min: 0, amount1Min: 0, recipient: caller.address, collectTokens: true, collectReward: true, }), 'remove liq from tier #0 + collect'); // prettier-ignore
  // await logTxGas(manager.mint({ tierId: 0, tickLower: 73590, tickUpper: 84600, amount0Desired: bn('1937313698881786826219'), amount1Desired: bn('7901968494783592122078728'), ...mintArgs, }), 'add liq to tier #0'); // prettier-ignore
  // await logTxGas(manager.mint({ tierId: 0, tickLower: 73590, tickUpper: 84600, amount0Desired: bn('1937313698881786826219'), amount1Desired: bn('7901968494783592122078728'), ...mintArgs, }), 'add liq to tier #0'); // prettier-ignore
}

// const logSwap = async (pools: Pool | Pool[], fn: () => Promise<ContractTransaction>, note: string) => {
//   const prepare = async (pool: Pool) => {
//     const tiersBefore = await pool.allTiers();

//     // set block timestamp
//     const ts = (await ethers.provider.getBlock('latest')).timestamp;
//     await ethers.provider.send('evm_setNextBlockTimestamp', [ts + 60 * 15]);

//     const logFn = async () => {
//       const swapped: number[] = [];
//       const crossed: number[] = [];
//       const tiers = await pool.allTiers();
//       for (const [i, tierBefore] of tiersBefore.entries()) {
//         if (!tiers[i].sqrtP.eq(tierBefore.sqrtP)) swapped.push(i);
//         if (!tiers[i].liquidity.eq(tierBefore.liquidity)) crossed.push(i);
//       }
//       console.log('  swapped  ', swapped);
//       console.log('  crossed  ', crossed);
//     };
//     return logFn;
//   };

//   pools = Array.isArray(pools) ? pools : [pools];
//   const logFns = await Promise.all(pools.map((pool) => prepare(pool)));
//   await logTxGas(fn(), note, async (_rec) => {
//     for (const logFn of logFns) {
//       await logFn();
//     }
//   });
// };
