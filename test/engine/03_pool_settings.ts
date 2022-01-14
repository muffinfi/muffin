import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { waffle } from 'hardhat';
import { MockEngine } from '../../typechain';
import { engineWithPoolFixture } from '../shared/fixtures';

describe('engine pool settings', () => {
  let engine: MockEngine;
  let user: SignerWithAddress;
  let other: SignerWithAddress;
  let poolId: string;

  beforeEach(async () => {
    ({ engine, user, other, poolId } = await waffle.loadFixture(engineWithPoolFixture));
    expect(await engine.governance()).eq(user.address);
  });

  it('cannot called by governance', async () => {
    await expect(engine.connect(other).setSqrtGamma(poolId, 0, 90000)).to.be.revertedWith('');
    await expect(engine.connect(other).setTickSpacing(poolId, 123)).to.be.revertedWith('');
    await expect(engine.connect(other).setProtocolFee(poolId, 123)).to.be.revertedWith('');
    await expect(engine.connect(other).setGovernance(other.address)).to.be.revertedWith('');
    await expect(engine.connect(other).setDefaults(123, 234)).to.be.revertedWith('');
  });

  it('setSqrtGamma', async () => {
    await expect(engine.setSqrtGamma(poolId, 0, 90000)).to.emit(engine, 'UpdateTier').withArgs(poolId, 0, 90000);
    expect((await engine.getTier(poolId, 0)).sqrtGamma).eq(90000);
  });

  it('setTickSpacing', async () => {
    await expect(engine.setTickSpacing(poolId, 123)).to.emit(engine, 'UpdateTickSpacing').withArgs(poolId, 123);
    expect((await engine.getPoolBasics(poolId)).tickSpacing).eq(123);
  });

  it('setProtocolFee', async () => {
    await expect(engine.setProtocolFee(poolId, 234)).to.emit(engine, 'UpdateProtocolFee').withArgs(poolId, 234);
    expect((await engine.getPoolBasics(poolId)).protocolFee).eq(234);
  });

  it('setGovernance', async () => {
    await expect(engine.setGovernance(other.address)).to.emit(engine, 'GovernanceUpdated').withArgs(other.address);
    expect(await engine.governance()).eq(other.address);
  });

  it('setDefaults', async () => {
    await engine.setDefaults(123, 234);
    expect((await engine.getDefaults()).tickSpacing).eq(123);
    expect((await engine.getDefaults()).protocolFee).eq(234);
  });

  it('collectProtocolFee'); // TODO: pending to decide when to store protocol fee
});
