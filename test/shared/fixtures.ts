import { ethers } from 'hardhat';
import { Engine, MockCaller, MockERC20, Pools, MockPool } from '../../typechain';
import { deploy, wad } from './utils';

export const poolTestFixture = async () => {
  const poolLib = (await deploy('Pools')) as Pools;
  const MockPool = await ethers.getContractFactory('MockPool', { libraries: { Pools: poolLib.address } });
  const pool = (await deploy(MockPool)) as MockPool;
  return { pool };
};

///
///
///

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
};
