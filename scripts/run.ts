import chalk from 'chalk';
import { BigNumberish, constants } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { ethers } from 'hardhat';
import { MuffinHub, MuffinHubPositions, Manager, MockERC20, Pools, WETH9 } from '../typechain';
import { bn, deployQuiet, logTxGas, wad } from './utils';

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

const { MaxUint256 } = constants;

async function main() {
  console.log(chalk.cyan.bold('\n=============== main ==============='));
  const [user] = await ethers.getSigners();

  // ===== deploy tokens =====
  const weth = (await deployQuiet('WETH9')) as WETH9;
  const tokenA = (await deployQuiet('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
  const tokenB = (await deployQuiet('MockERC20', 'BBB Token', 'BBB')) as MockERC20;
  const [token0, token1] = [tokenA, tokenB].sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));

  // ===== deploy contracts =====
  const positionController = (await deployQuiet('MuffinHubPositions')) as MuffinHubPositions;
  const hub = (await deployQuiet('MuffinHub', positionController.address)) as MuffinHub;
  const manager = (await deployQuiet('Manager', hub.address, weth.address)) as Manager;

  // ===== token approval =====
  for (const token of [token0, token1]) {
    await token.mint(wad('1_000_000_000_000'));
    await token.approve(manager.address, constants.MaxUint256);
  }

  // ===== deposit some tokens =====
  await logTxGas(manager.deposit(user.address, token0.address, wad('100_000_000_000')), 'deposit token0');
  await logTxGas(manager.deposit(user.address, token1.address, wad('100_000_000_000')), 'deposit token1');

  // ===== create pool and add tiers =====
  const price = 3100.0;
  const sqrtP = bn(Math.floor(price ** 0.5 * 100_000_000)).shl(72).div(100_000_000); // prettier-ignore
  await logTxGas(manager.createPool(token0.address, token1.address, 99850, sqrtP), 'create pool');

  await manager.depositToExternal(user.address, 1, token0.address, wad(1));
  await manager.depositToExternal(user.address, 1, token1.address, wad(1));
  await hub.addTier(token0.address, token1.address, 99750, 1); // add tier 50 bps
  await hub.addTier(token0.address, token1.address, 99925, 1); // add tier 15 bps
  await hub.addTier(token0.address, token1.address, 99975, 1); // add tier  5 bps
  await hub.addTier(token0.address, token1.address, 99990, 1); // add tier  2 bps

  const poolId = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]));
  const _hub = (await ethers.getContractAt('MuffinHubPositions', hub.address)) as MuffinHubPositions;
  await _hub.setPoolParameters(poolId, 1, Math.floor(0.15 * 255));

  // ===== add liquidity =====
  const mintArgs = {
    token0: token0.address,
    token1: token1.address,
    amount0Min: 0,
    amount1Min: 0,
    recipient: user.address,
    useAccount: false,
  };

  await logTxGas(manager.mint({ tierId: 0, tickLower: 73590, tickUpper: 84600, amount0Desired: bn('1778324121540511754519'), amount1Desired: bn('8386621433110935553190086'), ...mintArgs }), 'add liq to tier #0'); // prettier-ignore
  await logTxGas(manager.mint({ tierId: 0, tickLower: 79980, tickUpper: 80430, amount0Desired: bn('16122094877966737687'), amount1Desired: bn('597970165701708869328023'), ...mintArgs }), 'add liq to tier #0'); // prettier-ignore
  await logTxGas(manager.mint({ tierId: 1, tickLower: 73590, tickUpper: 84600, amount0Desired: bn('1513611219450397607500'), amount1Desired: bn('7138228706836276349920156'), ...mintArgs }), 'add liq to tier #1'); // prettier-ignore
  await logTxGas(manager.mint({ tierId: 2, tickLower: 73590, tickUpper: 84600, amount0Desired: bn('2535129731265710558269'), amount1Desired: bn('11955735786529073728150163'), ...mintArgs }), 'add liq to tier #2'); // prettier-ignore
  await logTxGas(manager.mint({ tierId: 3, tickLower: 73590, tickUpper: 84600, amount0Desired: bn('286678955155849426504'), amount1Desired: bn('1351985186844986656226470'), ...mintArgs }), 'add liq to tier #3'); // prettier-ignore
  await logTxGas(manager.mint({ tierId: 4, tickLower: 73590, tickUpper: 84600, amount0Desired: bn('681012341210208634'), amount1Desired: bn('3211671386461864918821'), ...mintArgs }), 'add liq to tier #4'); // prettier-ignore

  // // ===== swap =====
  const wait = async () => {
    const ts = (await ethers.provider.getBlock('latest')).timestamp;
    await ethers.provider.send('evm_setNextBlockTimestamp', [ts + 60 * 15]);
  };

  const toPath = (tokens: string[]) => {
    const types = [];
    const values = [];
    for (const token of tokens) {
      types.push('address');
      types.push('uint8');
      values.push(token);
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
    await logTxGas(
      amountDesired >= 0
        ? manager.exactInSingle(tokenIn, tokenOut, 0b111111, amountDesired, 0, user.address, false, false, MaxUint256)
        : manager.exactOutSingle(tokenIn, tokenOut, 0b111111, amountDesired, constants.MaxUint256, user.address, false, false, MaxUint256), // prettier-ignore
      notes,
    );
    // await logTxGas(
    //   amountDesired >= 0
    //     ? manager.exactIn(toPath([tokenIn, tokenOut]), amountDesired, 0, user.address, false, false)
    //     : manager.exactOut(toPath([tokenOut, tokenIn]), amountDesired, constants.MaxUint256, user.address, false, false),
    //   notes,
    // );
  };

  await swap(true, wad('1000'), 'swap #1');
  await swap(false, wad('2_000_000'), 'swap #2');
  await swap(true, wad('200'), 'swap #3');
  await swap(false, wad('100_000'), 'swap #4');
  await swap(true, wad('10'), 'swap #5');
  await swap(true, wad('100'), 'swap #6');

  // await logTxGas(manager.mint({ tierId: 0, tickLower: 79980, tickUpper: 80430, amount0Desired: bn('10000'), amount1Desired: bn('10000'), ...mintArgs }), 'add liq to tier #0');
  await swap(true, wad('300'), 'swap #7');

  // ===== remove + collect and re-add liq =====
  const position = await manager.getPosition(1);
  await logTxGas(
    manager.removeLiquidity({
      tokenId: 1,
      liquidityD8: position.position.liquidityD8,
      amount0Min: 0,
      amount1Min: 0,
      withdrawTo: user.address,
      collectAllFees: true,
      settled: false,
    }),
    'burn all liq in these ticks',
  );
  await logTxGas(manager.mint({ ...mintArgs, useAccount: false, tierId: 0, tickLower: 73590, tickUpper: 84600, amount0Desired: bn('1937313698881786826219'), amount1Desired: bn('7901968494783592122078728') }), 'add liq to tier #0'); // prettier-ignore
  await logTxGas(manager.mint({ ...mintArgs, useAccount: false, recipient: user.address, tierId: 0, tickLower: 79980, tickUpper: 84600, amount0Desired: bn('1937313698881786826219'), amount1Desired: bn('7901968494783592122078728') }), 'add liq to tier #0'); // prettier-ignore
}
