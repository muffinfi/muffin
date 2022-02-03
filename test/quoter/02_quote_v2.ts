import { expect } from 'chai';
import { solidityPack } from 'ethers/lib/utils';
import { waffle } from 'hardhat';
import { IMockMuffinHub, MockERC20, QuoterV2 } from '../../typechain';
import { managerFixture } from '../shared/fixtures';
import { deploy } from '../shared/utils';

describe('swap quoter v2', () => {
  let token0: MockERC20;
  let token1: MockERC20;
  let quoter: QuoterV2;

  beforeEach(async () => {
    let hub: IMockMuffinHub;
    ({ hub, token0, token1 } = await waffle.loadFixture(managerFixture));
    quoter = (await deploy('QuoterV2', hub.address)) as QuoterV2;
  });

  context('simulateSingle', async () => {
    it('exact in', async () => {
      const result = await quoter.simulateSingle(token0.address, token1.address, 0x3f, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.tierAmountsIn[0]).eq(3);
    });

    it('exact out', async () => {
      const result = await quoter.simulateSingle(token0.address, token1.address, 0x3f, -1);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.tierAmountsIn[0]).eq(3);
    });
  });

  context('simulate', async () => {
    const toPath = (tokens: MockERC20[]) => {
      const types = [];
      const values = [];
      for (const token of tokens) {
        types.push('address');
        types.push('uint8');
        values.push(token.address);
        values.push(0b111111);
      }
      types.pop();
      values.pop();
      return solidityPack(types, values);
    };

    it('exact in', async () => {
      const path = toPath([token0, token1]);
      const result = await quoter.simulate(path, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.hops[0].tierAmountsIn[0]).eq(3);
    });

    it('exact out', async () => {
      const path = toPath([token1, token0]);
      const result = await quoter.simulate(path, 3);
      expect(result.amountIn).eq(3);
      expect(result.amountOut).eq(1);
      expect(result.hops[0].tierAmountsIn[0]).eq(3);
    });
  });
});
