const dynamoose = require('dynamoose')

export default class Persistent {
  constructor (scheme) {
    this.name = Persistent.constructor.name
    this.scheme = scheme
    // @todo prefix name table acordingly with env, project & vertical, 'DE-SCRIPTS-URLMONITOR'
    this.model = dynamoose.model(this.name, scheme)
  }

  get model () {
    return this.model
  }
}
