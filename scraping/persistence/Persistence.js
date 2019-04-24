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
    this.instance = dynamoose.local('http://host.docker.internal:8000') // This defaults to "http://localhost:8000"
  }

  get instance () {
    return this.instance
  }
}
