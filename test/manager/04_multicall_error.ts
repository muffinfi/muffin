import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { waffle } from 'hardhat';
import { Manager, MockERC20 } from '../../typechain';
import { managerFixture } from '../shared/fixtures';

describe('mulitcall error bubbling', () => {
  let manager: Manager;
  let token0: MockERC20;
  let token1: MockERC20;
  let user: SignerWithAddress;
  let other: SignerWithAddress;

  beforeEach(async () => {
    ({ manager, token0, token1, user, other } = await waffle.loadFixture(managerFixture));
  });

  it('custom error', async () => {
    const data = [
      manager.interface.encodeFunctionData('exactInSingle', [token0.address, token1.address, 0x3f, 0, 0, user.address, false, false]), // prettier-ignore
    ];
    await expect(manager.multicall(data)).to.revertedWith('InvalidAmount()');
  });

  it('error string', async () => {
    const data = [
      manager.interface.encodeFunctionData('exactInSingle', [token0.address, token1.address, 0x3f, 3, 0, user.address, false, false]), // prettier-ignore
    ];
    await expect(manager.connect(other).multicall(data)).to.revertedWith('ERC20: transfer amount exceeds balance');
  });
});
