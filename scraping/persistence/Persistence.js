const dynamoose = require('dynamoose')
// const dynalite = require('dynalite')

// const server = async () => {
//     const server = dynalite()
//     await server.listen(8000)
//     return server
// }

export default class Persistence {
  constructor () {
    // dynamoose.AWS.config.update({
    //   accessKeyId: 'AKID',
    //   secretAccessKey: 'SECRET',
    //   region: 'us-east-1'
    // });
    this.instance = dynamoose.local(process.env.DYNAMO_ENDPOINT)
  }

  get instance () {
    return this.instance
  }
}
