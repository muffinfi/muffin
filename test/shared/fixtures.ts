import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { ethers } from 'hardhat';
import { MockCaller, MockEngine, MockERC20, MockPool, Pools } from '../../typechain';
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

  // ===== token =====
  const tokenA = (await deploy('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
  const tokenB = (await deploy('MockERC20', 'BBB Token', 'BBB')) as MockERC20;
  const [token0, token1] = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const poolId = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]));

  // ===== test users =====
  const [user, other] = await ethers.getSigners();

  return { engine, caller, token0, token1, user, other, poolId };
};

export const engineWithPoolFixture = async () => {
  const fixture = await engineFixture();
  const { engine, caller, token0, token1, user } = fixture;

  // ===== create pool =====
  await engine.addAccountBalance(user.address, 1, token0.address, 25600);
  await engine.addAccountBalance(user.address, 1, token1.address, 25600);
  await engine.setDefaults(1, 25);
  await engine.createPool(token0.address, token1.address, 99850, bn(1).shl(72), 1);

  // ===== token approval =====
  for (const token of [token0, token1]) {
    await token.mint(wad('100'));
    await token.approve(caller.address, wad('100'));
  }

  return fixture;
};

export const engineWithTwoPoolsFixture = async () => {
  // ===== contracts =====
  const poolLib = (await deploy('Pools')) as Pools;
  const MockEngine = await ethers.getContractFactory('MockEngine', { libraries: { Pools: poolLib.address } });
  const engine = (await deploy(MockEngine)) as MockEngine;
  const caller = (await deploy('MockCaller', engine.address)) as MockCaller;

  // ===== token =====
  const tokenA = (await deploy('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
  const tokenB = (await deploy('MockERC20', 'BBB Token', 'BBB')) as MockERC20;
  const tokenC = (await deploy('MockERC20', 'CCC Token', 'CCC')) as MockERC20;
  const tokens = [tokenA, tokenB, tokenC].sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));
  const [token0, token1, token2] = tokens;

  // ===== test users =====
  const [user, other] = await ethers.getSigners();

  // ===== create pools =====
  await engine.addAccountBalance(user.address, 1, token0.address, 25600 * 2);
  await engine.addAccountBalance(user.address, 1, token1.address, 25600 * 2);
  await engine.addAccountBalance(user.address, 1, token2.address, 25600 * 2);

  await engine.setDefaults(1, 25);
  await engine.createPool(token0.address, token1.address, 99850, bn(1).shl(72), 1);
  await engine.createPool(token1.address, token2.address, 99850, bn(1).shl(72), 1);
  await engine.createPool(token0.address, token2.address, 99850, bn(1).shl(72), 1);

  const poolId01 = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]));
  const poolId12 = keccak256(defaultAbiCoder.encode(['address', 'address'], [token1.address, token2.address]));
  const poolId02 = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token2.address]));

  // ===== token approval =====
  for (const token of [token0, token1, token2]) {
    await token.mint(wad('100'));
    await token.approve(caller.address, wad('100'));
  }

  return { engine, caller, token0, token1, token2, user, other, poolId01, poolId12, poolId02 };
};
