import { ethers } from 'hardhat';
import { Engine, MockCaller, MockERC20, Pools } from '../../typechain';
import { deploy, wad } from './utils';

export const rawEngineFixture = async () => {
  // ===== wallets =====
  const [user, other] = await ethers.getSigners();

  // ====== token =====
  const weth = await deploy('WETH9');
  const tokenA = (await deploy('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
  const tokenB = (await deploy('MockERC20', 'BBB Token', 'BBB')) as MockERC20;
  const [token0, token1] = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];

  // ===== deploy contracts =====
  const poolLib = (await deploy('Pools')) as Pools;
  const Engine = await ethers.getContractFactory('Engine', { libraries: { Pools: poolLib.address } });
  const engine = (await deploy(Engine)) as Engine;
  const caller = (await deploy('MockCaller')) as MockCaller;

  // ===== token approval =====
  for (const token of [token0, token1]) {
    await token.mint(wad('100_000_000_000'));
    await token.approve(engine.address, wad('100_000_000_000'));
    await token.approve(caller.address, wad('100_000_000_000'));
  }

  // ===== deposit tokens =====
  const accountId = 1;
  await caller.deposit(engine.address, caller.address, accountId, token0.address, wad('100_000_000_000')); // prettier-ignore
  await caller.deposit(engine.address, caller.address, accountId, token1.address, wad('100_000_000_000')); // prettier-ignore
  await caller.deposit(engine.address, user.address, accountId, token0.address, wad('100_000_000_000')); // prettier-ignore
  await caller.deposit(engine.address, user.address, accountId, token1.address, wad('100_000_000_000')); // prettier-ignore

  return { token0, token1, engine, caller, user, other };

  // // ===== create pool and init =====
  // await caller.createPool(engine.address, token0.address, token1.address, '99850', bn(1).shl(72), accountId);
};

// export const rawPoolFixture = async () => {
//   // ====== token =====
//   const weth = await deploy('WETH9');
//   const tokenA = (await deploy('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
//   const tokenB = (await deploy('MockERC20', 'BBB Token', 'BBB')) as MockERC20;
//   const [token0, token1] = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];

//   // ===== factory, position manager =====
//   const Pool = await ethers.getContractFactory('Pool');
//   const poolBytecodeHash = ethers.utils.keccak256(Pool.bytecode);
//   const liqUpdater = (await deploy('PoolLiquidityUpdater')) as PoolLiquidityUpdater;
//   const factory = (await deploy('PoolFactory', liqUpdater.address)) as PoolFactory;
//   const manager = (await deploy('PositionManager', factory.address, weth.address, poolBytecodeHash)) as PositionManager; // prettier-ignore

//   // ===== create pool =====
//   const poolTx = await factory.createPool(token0.address, token1.address);
//   const poolAddress: string = (await poolTx.wait()).events?.find((e) => e.event === 'PoolCreated')?.args?.pool;
//   const pool = Pool.attach(poolAddress) as Pool;

//   // ===== set pool's tick spacing =====
//   await pool.setTickSpacing(30);

//   // ===== mock pool caller =====
//   const caller = (await deploy('MockPoolCaller')) as MockPoolCaller;

//   // ===== token approval =====
//   const amount = wad('100_000_000_000_000_000');
//   await token0.mint(amount);
//   await token1.mint(amount);
//   await token0.approve(pool.address, amount);
//   await token1.approve(pool.address, amount);
//   await token0.approve(manager.address, amount);
//   await token1.approve(manager.address, amount);
//   await token0.approve(caller.address, amount);
//   await token1.approve(caller.address, amount);

//   // ===== wallets =====
//   const [user, other] = await ethers.getSigners();

//   return { token0, token1, factory, manager, pool, user, other, caller };
// };

// //
// //
// //
// //

// export const poolFixture = async () => {
//   const fixture = await rawPoolFixture();
//   const { pool } = fixture;
//   await pool.initialize(99850, ethers.BigNumber.from(1).shl(72));
//   // await pool.setRewardParams(ethers.constants.AddressZero, 1e10, false);
//   await pool.setProtocolFee(1000);
//   return fixture;
// };

// //
// //
// //
// //

// export const routerFixture = async () => {
//   // ====== token =====
//   const tokenA = (await deploy('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
//   const tokenB = (await deploy('MockERC20', 'BBB Token', 'BBB')) as MockERC20;
//   const tokenC = (await deploy('MockERC20', 'CCC Token', 'CCC')) as MockERC20;
//   const tokens = [tokenA, tokenB, tokenC].sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));
//   const [token0, token1, token2] = tokens;

//   let weth = (await deploy('WETH9')) as WETH9;
//   while (weth.address.toLowerCase() > token2.address.toLowerCase()) weth = (await deploy('WETH9')) as WETH9;

//   // ===== factory, position manager, swap router =====
//   const Pool = await ethers.getContractFactory('Pool');
//   const poolBytecodeHash = ethers.utils.keccak256(Pool.bytecode);
//   const liqUpdater = (await deploy('PoolLiquidityUpdater')) as PoolLiquidityUpdater;
//   const factory = (await deploy('PoolFactory', liqUpdater.address)) as PoolFactory;
//   const manager = (await deploy('PositionManager', factory.address, weth.address, poolBytecodeHash)) as PositionManager; // prettier-ignore
//   const router = (await deploy('SwapRouter', factory.address, weth.address, poolBytecodeHash)) as SwapRouter;

//   // ===== create pool =====
//   const poolTx1 = await factory.createPool(token0.address, token1.address);
//   const poolTx2 = await factory.createPool(token1.address, token2.address);
//   const poolTx3 = await factory.createPool(weth.address, token2.address);

//   const pool1 = Pool.attach((await poolTx1.wait()).events?.find((e) => e.event === 'PoolCreated')?.args?.pool) as Pool;
//   const pool2 = Pool.attach((await poolTx2.wait()).events?.find((e) => e.event === 'PoolCreated')?.args?.pool) as Pool;
//   const pool3 = Pool.attach((await poolTx3.wait()).events?.find((e) => e.event === 'PoolCreated')?.args?.pool) as Pool;

//   // ===== set pool's tick spacing =====
//   await pool1.setTickSpacing(30);
//   await pool2.setTickSpacing(30);
//   await pool3.setTickSpacing(30);

//   // ===== token approval =====
//   const E35 = wad('100_000_000_000_000_000');
//   for (const token of [token0, token1, token2]) {
//     await token.mint(E35);
//     await token.approve(pool1.address, E35);
//     await token.approve(pool2.address, E35);
//     await token.approve(pool3.address, E35);
//     await token.approve(router.address, E35);
//     await token.approve(manager.address, E35);
//   }
//   await weth.deposit({ value: E35 });
//   await weth.approve(pool3.address, E35);
//   await weth.approve(router.address, E35);
//   await weth.approve(manager.address, E35);

//   // ===== wallets =====
//   const [user, other] = await ethers.getSigners();

//   // ===== mock pool caller =====
//   const caller = (await deploy('MockPoolCaller')) as MockPoolCaller;

//   return { poolBytecodeHash, token0, token1, token2, weth, factory, manager, router, pool1, pool2, pool3, user, other, caller };
// };
