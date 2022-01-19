import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { waffle } from 'hardhat';
import { IMockEngine } from '../../typechain';
import { engineWithPoolFixture } from '../shared/fixtures';

describe('engine pool settings', () => {
  let engine: IMockEngine;
  let user: SignerWithAddress;
  let other: SignerWithAddress;
  let poolId: string;

  beforeEach(async () => {
    ({ engine, user, other, poolId } = await waffle.loadFixture(engineWithPoolFixture));
    expect(await engine.governance()).eq(user.address);
  });

  it('cannot called by governance', async () => {
    await expect(engine.connect(other).setTierParameters(poolId, 0, 90000, 0)).to.be.revertedWith('');
    await expect(engine.connect(other).setPoolParameters(poolId, 123, 234)).to.be.revertedWith('');
    await expect(engine.connect(other).setGovernance(other.address)).to.be.revertedWith('');
    await expect(engine.connect(other).setDefaultParameters(123, 234)).to.be.revertedWith('');
  });

  it('setTierParameters', async () => {
    await expect(engine.setTierParameters(poolId, 0, 90000, 10)).to.emit(engine, 'UpdateTier').withArgs(poolId, 0, 90000, 10);
    expect((await engine.getTier(poolId, 0)).sqrtGamma).eq(90000);
    expect((await engine.getLimitOrderTickSpacingMultipliers(poolId))[0]).eq(10);
  });

  it('setPoolParameters', async () => {
    await expect(engine.setPoolParameters(poolId, 123, 234)).to.emit(engine, 'UpdatePool').withArgs(poolId, 123, 234);
    expect((await engine.getPoolParameters(poolId)).tickSpacing).eq(123);
    expect((await engine.getPoolParameters(poolId)).protocolFee).eq(234);
  });

  it('setGovernance', async () => {
    await expect(engine.setGovernance(other.address)).to.emit(engine, 'GovernanceUpdated').withArgs(other.address);
    expect(await engine.governance()).eq(other.address);
  });

  it('setDefaultParameters', async () => {
    await engine.setDefaultParameters(123, 234);
    expect((await engine.getDefaultParameters()).tickSpacing).eq(123);
    expect((await engine.getDefaultParameters()).protocolFee).eq(234);
  });
});
