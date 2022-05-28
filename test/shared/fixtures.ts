import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { ethers } from 'hardhat';
import { MuffinHubPositions, IMockMuffinHub, Manager, MockCaller, MockERC20, MockPool, Pools, WETH9 } from '../../typechain';
import { bn, deploy, wad } from './utils';

export const poolTestFixture = async () => {
  const pool = (await deploy('MockPool')) as MockPool;
  return { pool };
};

export const hubFixture = async () => {
  // ===== contracts =====
  const positionController = (await deploy('MuffinHubPositions')) as MuffinHubPositions;
  const _hub = await deploy('MockMuffinHub', positionController.address);
  const hub = (await ethers.getContractAt('IMockMuffinHub', _hub.address)) as IMockMuffinHub;
  const caller = (await deploy('MockCaller', hub.address)) as MockCaller;

  // ===== token =====
  const tokenA = (await deploy('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
  const tokenB = (await deploy('MockERC20', 'BBB Token', 'BBB')) as MockERC20;
  const [token0, token1] = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
  const poolId = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]));

  // ===== test users =====
  const [user, other] = await ethers.getSigners();

  // ===== change allowed sqrtGamma =====
  await hub.setDefaultAllowedSqrtGammas([99850]);

  return { hub, caller, token0, token1, user, other, poolId };
};

export const hubWithPoolFixture = async () => {
  const fixture = await hubFixture();
  const { hub, caller, token0, token1, user } = fixture;

  // ===== create pool =====
  await hub.addAccountBalance(user.address, 1, token0.address, 25600);
  await hub.addAccountBalance(user.address, 1, token1.address, 25600);
  await hub.setDefaultParameters(1, 25);
  await hub.createPool(token0.address, token1.address, 99850, bn(1).shl(72), 1);

  // ===== token approval =====
  for (const token of [token0, token1]) {
    await token.mint(wad('100'));
    await token.approve(caller.address, wad('100'));
  }

  return fixture;
};

export const hubWithTwoPoolsFixture = async () => {
  // ===== contracts =====
  const positionController = (await deploy('MuffinHubPositions')) as MuffinHubPositions;
  const _hub = (await deploy('MockMuffinHub', positionController.address)) as IMockMuffinHub;
  const hub = (await ethers.getContractAt('IMockMuffinHub', _hub.address)) as IMockMuffinHub;
  const caller = (await deploy('MockCaller', hub.address)) as MockCaller;

  // ===== token =====
  const tokenA = (await deploy('MockERC20', 'AAA Token', 'AAA')) as MockERC20;
  const tokenB = (await deploy('MockERC20', 'BBB Token', 'BBB')) as MockERC20;
  const tokenC = (await deploy('MockERC20', 'CCC Token', 'CCC')) as MockERC20;
  const tokens = [tokenA, tokenB, tokenC].sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1));
  const [token0, token1, token2] = tokens;

  // ===== test users =====
  const [user, other] = await ethers.getSigners();

  // ===== create pools =====
  await hub.addAccountBalance(user.address, 1, token0.address, 25600 * 2);
  await hub.addAccountBalance(user.address, 1, token1.address, 25600 * 2);
  await hub.addAccountBalance(user.address, 1, token2.address, 25600 * 2);

  await hub.setDefaultParameters(1, 25);
  await hub.setDefaultAllowedSqrtGammas([99850]);
  await hub.createPool(token0.address, token1.address, 99850, bn(1).shl(72), 1);
  await hub.createPool(token1.address, token2.address, 99850, bn(1).shl(72), 1);
  await hub.createPool(token0.address, token2.address, 99850, bn(1).shl(72), 1);

  const poolId01 = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token1.address]));
  const poolId12 = keccak256(defaultAbiCoder.encode(['address', 'address'], [token1.address, token2.address]));
  const poolId02 = keccak256(defaultAbiCoder.encode(['address', 'address'], [token0.address, token2.address]));

  // ===== token approval =====
  for (const token of [token0, token1, token2]) {
    await token.mint(wad('100'));
    await token.approve(caller.address, wad('100'));
  }

  return { hub, caller, token0, token1, token2, user, other, poolId01, poolId12, poolId02 };
};

export const managerFixture = async () => {
  const fixture = await hubWithTwoPoolsFixture();
  const { hub, token0, token1, token2, user, other } = fixture;

  // ===== deploy weth, must be a larger address than token2's =====
  let weth = (await deploy('WETH9')) as WETH9;
  while (weth.address.toLowerCase() < token2.address.toLowerCase()) weth = (await deploy('WETH9')) as WETH9;
  await weth.deposit({ value: wad('100') });

  // ===== deploy manager, approve tokens =====
  const manager = (await deploy('Manager', hub.address, weth.address)) as Manager;
  for (const token of [token0, token1, token2, weth]) {
    await token.connect(user).approve(manager.address, wad('100'));
    await token.connect(other).approve(manager.address, wad('100'));
  }

  // ===== create token2-weth pool =====
  await hub.addAccountBalance(user.address, 1, token2.address, 25600);
  await manager.depositToExternal(user.address, 1, weth.address, 25600);
  await hub.createPool(token2.address, weth.address, 99850, bn(1).shl(72), 1);
  const poolId2E = keccak256(defaultAbiCoder.encode(['address', 'address'], [token2.address, weth.address]));

  return { ...fixture, manager, weth, poolId2E };
};
