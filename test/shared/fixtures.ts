import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { ethers } from 'hardhat';
import { Engine, MockCaller, MockERC20, Pools, MockPool, MockEngine } from '../../typechain';
import { bn, deploy, wad } from './utils';

export const poolTestFixture = async () => {
  const poolLib = (await deploy('Pools')) as Pools;
  const MockPool = await ethers.getContractFactory('MockPool', { libraries: { Pools: poolLib.address } });
  const pool = (await deploy(MockPool)) as MockPool;
  return { pool };
};

export const engineFixture = async () => {
  // ===== contracts =====
  const poolLib = (await deploy('Pools')) as Pools;
  const MockEngine = await ethers.getContractFactory('MockEngine', { libraries: { Pools: poolLib.address } });
  const engine = (await deploy(MockEngine)) as MockEngine;
  const caller = (await deploy('MockCaller', engine.address)) as MockCaller;

  // ====== token =====
  const tokenA = (await deploy('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
  const tokenB = (await deploy('MockERC20', 'BBB Token', 'BBB')) as MockERC20;
  const [token0, token1] = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const poolId = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]));

  const [user, other] = await ethers.getSigners();

  return { engine, caller, token0, token1, user, other, poolId };
};

export const engineWithPoolFixture = async () => {
  const fixture = await engineFixture();
  const { engine, token0, token1, user } = fixture;
  await engine.addAccountBalance(user.address, 1, token0.address, 25600);
  await engine.addAccountBalance(user.address, 1, token1.address, 25600);
  await engine.setDefaults(1, 25);
  await engine.createPool(token0.address, token1.address, 99850, bn(1).shl(72), 1);
  return fixture;
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
  const caller = (await deploy('MockCaller', engine.address)) as MockCaller;

  // ===== token approval =====
  for (const token of [token0, token1]) {
    await token.mint(wad('100_000_000_000'));
    await token.approve(engine.address, wad('100_000_000_000'));
    await token.approve(caller.address, wad('100_000_000_000'));
  }

  // ===== deposit tokens =====
  const accId = 1;
  await caller.deposit(caller.address, accId, token0.address, wad('100_000_000_000'), ''); // prettier-ignore
  await caller.deposit(caller.address, accId, token1.address, wad('100_000_000_000'), ''); // prettier-ignore
  await caller.deposit(user.address, accId, token0.address, wad('100_000_000_000'), ''); // prettier-ignore
  await caller.deposit(user.address, accId, token1.address, wad('100_000_000_000'), ''); // prettier-ignore

  return { token0, token1, engine, caller, user, other };
};
