import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { constants } from 'ethers';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { MockCaller, MockEngine, MockERC20 } from '../../typechain';
import { engineFixture } from '../shared/fixtures';
import { bn, deploy } from '../shared/utils';

const Q72 = bn(1).shl(72);

describe('engine create pool', () => {
  let engine: MockEngine;
  let caller: MockCaller;
  let token0: MockERC20;
  let token1: MockERC20;
  let user: SignerWithAddress;
  let poolId: string;

  beforeEach(async () => {
    ({ engine, caller, token0, token1, user, poolId } = await waffle.loadFixture(engineFixture));
    await engine.addAccountBalance(user.address, 1, token0.address, 25600);
    await engine.addAccountBalance(user.address, 1, token1.address, 25600);
  });

  const getAccBalance = async (token: string, owner: string, accId: number) => {
    const accHash = keccak256(defaultAbiCoder.encode(['address', 'uint256'], [owner, accId]));
    return await engine.accounts(token, accHash);
  };

  context('create pool', () => {
    it('zero token address', async () => {
      await expect(engine.createPool(constants.AddressZero, token1.address, 99850, Q72, 1)).to.be.revertedWith(
        'InvalidTokenOrder()',
      );
    });

    it('invalid token order', async () => {
      await expect(engine.createPool(token1.address, token0.address, 99850, Q72, 1)).to.be.revertedWith('InvalidTokenOrder()');
    });

    it('not enough token0', async () => {
      await engine.withdraw(caller.address, 1, token0.address, 1);
      await expect(engine.createPool(token0.address, token1.address, 99850, Q72, 1)).to.be.revertedWith('');
    });

    it('not enough token1', async () => {
      await engine.withdraw(caller.address, 1, token1.address, 1);
      await expect(engine.createPool(token0.address, token1.address, 99850, Q72, 1)).to.be.revertedWith('');
    });

    it('create pool successfully', async () => {
      expect(await getAccBalance(token0.address, user.address, 1)).eq(25600);
      expect(await getAccBalance(token1.address, user.address, 1)).eq(25600);

      const promise = engine.createPool(token0.address, token1.address, 99850, Q72, 1);
      await promise;

      // check events
      expect(promise).to.emit(engine, 'PoolCreated').withArgs(token0.address, token1.address);
      expect(promise).to.emit(engine, 'UpdateTier').withArgs(poolId, 0, 99850);

      // check underlying tokens are stored
      const underlying = await engine.underlyings(poolId);
      expect(underlying.token0).eq(token0.address);
      expect(underlying.token1).eq(token1.address);

      // check pool object created
      expect((await engine.getPoolBasics(poolId)).tickSpacing).gt(0);

      // check account balance change
      expect(await getAccBalance(token0.address, user.address, 1)).eq(0);
      expect(await getAccBalance(token1.address, user.address, 1)).eq(0);
    });

    it('pool already created', async () => {
      await engine.addAccountBalance(user.address, 1, token0.address, 100_000_000);
      await engine.addAccountBalance(user.address, 1, token1.address, 100_000_000);
      await engine.createPool(token0.address, token1.address, 99850, Q72, 1);
      expect(engine.createPool(token0.address, token1.address, 99850, Q72, 1)).to.be.revertedWith('');
    });
  });

  context('add tier', () => {
    beforeEach(async () => {
      await engine.createPool(token0.address, token1.address, 99850, Q72, 1);
      await engine.addAccountBalance(user.address, 1, token0.address, 25600);
      await engine.addAccountBalance(user.address, 1, token1.address, 25600);
      expect(await getAccBalance(token0.address, user.address, 1)).eq(25600);
      expect(await getAccBalance(token1.address, user.address, 1)).eq(25600);
    });

    it('zero token address', async () => {
      await expect(engine.addTier(constants.AddressZero, token1.address, 99850, 1)).to.be.revertedWith('');
    });

    it('invalid token order', async () => {
      await expect(engine.addTier(token1.address, token0.address, 99850, 1)).to.be.revertedWith('');
    });

    it('not enough token0', async () => {
      await engine.withdraw(caller.address, 1, token0.address, 1);
      await expect(engine.addTier(token0.address, token1.address, 99850, 1)).to.be.revertedWith('');
    });

    it('not enough token1', async () => {
      await engine.withdraw(caller.address, 1, token1.address, 1);
      await expect(engine.addTier(token0.address, token1.address, 99850, 1)).to.be.revertedWith('');
    });

    it('pool not created', async () => {
      const tokenC = (await deploy('MockERC20', 'CCC Token', 'CCC')) as MockERC20;
      const pair = token0.address.toLowerCase() < tokenC.address.toLowerCase() ? [token0, tokenC] : [tokenC, token0];
      await engine.addAccountBalance(user.address, 1, tokenC.address, 25600);
      await expect(engine.addTier(pair[0].address, pair[1].address, 99850, 1)).to.be.revertedWith('');
    });

    it('add tier successfully', async () => {
      const tierCount = await engine.getTiersCount(poolId);
      const promise = engine.addTier(token0.address, token1.address, 99850, 1);
      await promise;

      // check events
      expect(promise)
        .to.emit(engine, 'UpdateTier')
        .withArgs(poolId, +tierCount, 99850);

      // check tier count
      expect(await engine.getTiersCount(poolId)).eq(tierCount.add(1));

      // check account balance change
      expect(await getAccBalance(token0.address, user.address, 1)).eq(0);
      expect(await getAccBalance(token1.address, user.address, 1)).eq(0);
    });

    it('exceeded max tier count', async () => {
      await engine.addAccountBalance(user.address, 1, token0.address, 1e15);
      await engine.addAccountBalance(user.address, 1, token1.address, 1e15);

      for (let i = 0; i < 5; i++) await engine.addTier(token0.address, token1.address, 99850, 1);
      expect(await engine.getTiersCount(poolId)).eq(6);
      await expect(engine.addTier(token0.address, token1.address, 99850, 1)).to.be.revertedWith('');
    });
  });
});
