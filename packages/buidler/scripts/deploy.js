const fs = require("fs");
const chalk = require("chalk");
const { config, ethers } = require("@nomiclabs/buidler");

async function deploy(name, _args) {
  const args = _args || [];

  console.log(`📄 ${name}`);
  const contractArtifacts = await ethers.getContractFactory(name);
  const contract = await contractArtifacts.deploy(...args);
  console.log(
    chalk.cyan(name),
    "deployed to:",
    chalk.magenta(contract.address)
  );
  fs.writeFileSync(`artifacts/${name}.address`, contract.address);
  console.log("\n");
  return contract;
}

const isSolidity = (fileName) =>
  fileName.indexOf(".sol") >= 0 && fileName.indexOf(".swp.") < 0;

function readArgumentsFile(contractName) {
  let args = [];
  try {
    const argsFile = `./contracts/${contractName}.args`;
    if (fs.existsSync(argsFile)) {
      args = JSON.parse(fs.readFileSync(argsFile));
    }
  } catch (e) {
    console.log(e);
  }

  return args;
}

async function autoDeploy() {
  const contractList = fs.readdirSync(config.paths.sources);
  return contractList
    .filter((fileName) => isSolidity(fileName))
    .reduce((lastDeployment, fileName) => {
      const contractName = fileName.replace(".sol", "");
      const args = readArgumentsFile(contractName);

      // Wait for last deployment to complete before starting the next
      return lastDeployment.then((resultArrSoFar) =>
        deploy(contractName, args).then((result) => [...resultArrSoFar, result])
      );
    }, Promise.resolve([]));
}

async function main() {
  console.log("📡 Deploy \n");
  // auto deploy to read contract directory and deploy them all (add ".args" files for arguments)
  // await autoDeploy();
  // OR
  // custom deploy (to use deployed addresses dynamically for example:)
  // const epns = await deploy("EPNS");
  const core = await deploy("EPNSCore");
  // const coreSetupTx = await tx(core.address, 'initliaze()')
  // const timeLock = await deploy("Timelock", []); // governor and a guardian,
  // const setupDetails = '0x'

  let logic = core.address;
  let governance = '0xA1bFBd2062f298a46f3E4160C89BEDa0716a3F51';
  let AAVE_LENDING_POOL = '0xA1bFBd2062f298a46f3E4160C89BEDa0716a3F51';
  let DAI = '0xA1bFBd2062f298a46f3E4160C89BEDa0716a3F51';
  let ADAI = '0xA1bFBd2062f298a46f3E4160C89BEDa0716a3F51';
  let referralCode = 0;
  const coreProxy = await deploy("EPNSProxy", [
    logic,
    governance,
    AAVE_LENDING_POOL,
    DAI,
    ADAI,
    referralCode,
  ]);

  // const Mock = await deploy('EPNSProxyMock');

  // const governorAlpha = await deploy("GovernorAlpha", [timeLock.address, epns.address, '0xA1bFBd2062f298a46f3E4160C89BEDa0716a3F51']);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
