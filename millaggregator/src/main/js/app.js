'use strict';

const React = require('react');
const ReactDOM = require('react-dom');
const when = require('when');
const client = require('./client');

const follow = require('./follow'); // function to hop multiple links by "rel"

const stompClient = require('./websocket-listener');

const root = '/api';

class App extends React.Component {

	constructor(props) {
		super(props);
		this.state = {aggregators: [], attributes: [], page: 1, pageSize: 2, links: {}};
		this.updatePageSize = this.updatePageSize.bind(this);
		this.onCreate = this.onCreate.bind(this);
		this.onUpdate = this.onUpdate.bind(this);
		this.onDelete = this.onDelete.bind(this);
		this.onNavigate = this.onNavigate.bind(this);
		this.refreshCurrentPage = this.refreshCurrentPage.bind(this);
		this.refreshAndGoToLastPage = this.refreshAndGoToLastPage.bind(this);
	}

	loadFromServer(pageSize) {
		follow(client, root, [
				{rel: 'aggregators', params: {size: pageSize}}]
		).then(aggregatorCollection => {
				return client({
					method: 'GET',
					path: aggregatorCollection.entity._links.profile.href,
					headers: {'Accept': 'application/schema+json'}
				}).then(schema => {
					this.schema = schema.entity;
					this.links = aggregatorCollection.entity._links;
					return aggregatorCollection;
				});
		}).then(aggregatorCollection => {
			this.page = aggregatorCollection.entity.page;
			return aggregatorCollection.entity._embedded.aggregators.map(aggregator =>
					client({
						method: 'GET',
						path: aggregator._links.self.href
					})
			);
		}).then(aggregatorPromises => {
			return when.all(aggregatorPromises);
		}).done(aggregators => {
			this.setState({
				page: this.page,
				aggregators: aggregators,
				attributes: Object.keys(this.schema.properties),
				pageSize: pageSize,
				links: this.links
			});
		});
	}

	// tag::on-create[]
	onCreate(newAggregator) {
		follow(client, root, ['aggregators']).done(response => {
			client({
				method: 'POST',
				path: response.entity._links.self.href,
				entity: newAggregator,
				headers: {'Content-Type': 'application/json'}
			})
		})
	}
	// end::on-create[]

	onUpdate(aggregator, updatedAggregator) {
		client({
			method: 'PUT',
			path: aggregator.entity._links.self.href,
			entity: updatedAggregator,
			headers: {
				'Content-Type': 'application/json',
				'If-Match': aggregator.headers.Etag
			}
		}).done(response => {
			/* Let the websocket handler update the state */
		}, response => {
			if (response.status.code === 412) {
				alert('DENIED: Unable to update ' + aggregator.entity._links.self.href + '. Your copy is stale.');
			}
		});
	}

	onDelete(aggregator) {
		client({method: 'DELETE', path: aggregator.entity._links.self.href});
	}

	onNavigate(navUri) {
		client({
			method: 'GET',
			path: navUri
		}).then(aggregatorCollection => {
			this.links = aggregatorCollection.entity._links;
			this.page = aggregatorCollection.entity.page;

			return aggregatorCollection.entity._embedded.aggregators.map(aggregator =>
					client({
						method: 'GET',
						path: aggregator._links.self.href
					})
			);
		}).then(aggregatorPromises => {
			return when.all(aggregatorPromises);
		}).done(aggregators => {
			this.setState({
				page: this.page,
				aggregators: aggregators,
				attributes: Object.keys(this.schema.properties),
				pageSize: this.state.pageSize,
				links: this.links
			});
		});
	}

	updatePageSize(pageSize) {
		if (pageSize !== this.state.pageSize) {
			this.loadFromServer(pageSize);
		}
	}

	// tag::websocket-handlers[]
	refreshAndGoToLastPage(message) {
		follow(client, root, [{
			rel: 'aggregators',
			params: {size: this.state.pageSize}
		}]).done(response => {
			if (response.entity._links.last !== undefined) {
				this.onNavigate(response.entity._links.last.href);
			} else {
				this.onNavigate(response.entity._links.self.href);
			}
		})
	}

	refreshCurrentPage(message) {
		follow(client, root, [{
			rel: 'aggregators',
			params: {
				size: this.state.pageSize,
				page: this.state.page.number
			}
		}]).then(aggregatorCollection => {
			this.links = aggregatorCollection.entity._links;
			this.page = aggregatorCollection.entity.page;

			return aggregatorCollection.entity._embedded.aggregators.map(aggregator => {
				return client({
					method: 'GET',
					path: aggregator._links.self.href
				})
			});
		}).then(aggregatorPromises => {
			return when.all(aggregatorPromises);
		}).then(aggregators => {
			this.setState({
				page: this.page,
				aggregators: aggregators,
				attributes: Object.keys(this.schema.properties),
				pageSize: this.state.pageSize,
				links: this.links
			});
		});
	}
	// end::websocket-handlers[]

	// tag::register-handlers[]
	componentDidMount() {
		this.loadFromServer(this.state.pageSize);
		stompClient.register([
			{route: '/topic/newAggregator', callback: this.refreshAndGoToLastPage},
			{route: '/topic/updateAggregator', callback: this.refreshCurrentPage},
			{route: '/topic/deleteAggregator', callback: this.refreshCurrentPage}
		]);
	}
	// end::register-handlers[]

	render() {
		return (
			<div>
				<CreateDialog attributes={this.state.attributes} onCreate={this.onCreate}/>
				<AggregatorList page={this.state.page}
							  aggregators={this.state.aggregators}
							  links={this.state.links}
							  pageSize={this.state.pageSize}
							  attributes={this.state.attributes}
							  onNavigate={this.onNavigate}
							  onUpdate={this.onUpdate}
							  onDelete={this.onDelete}
							  updatePageSize={this.updatePageSize}/>
			</div>
		)
	}
}

class CreateDialog extends React.Component {

	constructor(props) {
		super(props);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	handleSubmit(e) {
		e.preventDefault();
		const newAggregator = {};
		this.props.attributes.forEach(attribute => {
			newAggregator[attribute] = ReactDOM.findDOMNode(this.refs[attribute]).value.trim();
		});
		this.props.onCreate(newAggregator);
		this.props.attributes.forEach(attribute => {
			ReactDOM.findDOMNode(this.refs[attribute]).value = ''; // clear out the dialog's inputs
		});
		window.location = "#";
	}

	render() {
		const inputs = this.props.attributes.map(attribute =>
			<p key={attribute}>
				<input type="text" placeholder={attribute} ref={attribute} className="field"/>
			</p>
		);
		return (
			<div>
				<a href="#createAggregator">Create</a>

				<div id="createAggregator" className="modalDialog">
					<div>
						<a href="#" title="Close" className="close">X</a>

						<h2>Create new aggregator</h2>

						<form>
							{inputs}
							<button onClick={this.handleSubmit}>Create</button>
						</form>
					</div>
				</div>
			</div>
		)
	}
}

class UpdateDialog extends React.Component {

	constructor(props) {
		super(props);
		this.handleSubmit = this.handleSubmit.bind(this);
	}

	handleSubmit(e) {
		e.preventDefault();
		const updatedAggregator = {};
		this.props.attributes.forEach(attribute => {
			updatedAggregator[attribute] = ReactDOM.findDOMNode(this.refs[attribute]).value.trim();
		});
		this.props.onUpdate(this.props.aggregator, updatedAggregator);
		window.location = "#";
	}

	render() {
		const inputs = this.props.attributes.map(attribute =>
			<p key={this.props.aggregator.entity[attribute]}>
				<input type="text" placeholder={attribute}
					   defaultValue={this.props.aggregator.entity[attribute]}
					   ref={attribute} className="field"/>
			</p>
		);

		const dialogId = "updateAggregator-" + this.props.aggregator.entity._links.self.href;

		return (
			<div>
				<a href={"#" + dialogId}>Update</a>

				<div id={dialogId} className="modalDialog">
					<div>
						<a href="#" title="Close" className="close">X</a>

						<h2>Update an aggregator</h2>

						<form>
							{inputs}
							<button onClick={this.handleSubmit}>Update</button>
						</form>
					</div>
				</div>
			</div>
		)
	}

}

class AggregatorList extends React.Component {

	constructor(props) {
		super(props);
		this.handleNavFirst = this.handleNavFirst.bind(this);
		this.handleNavPrev = this.handleNavPrev.bind(this);
		this.handleNavNext = this.handleNavNext.bind(this);
		this.handleNavLast = this.handleNavLast.bind(this);
		this.handleInput = this.handleInput.bind(this);
	}

	handleInput(e) {
		e.preventDefault();
		const pageSize = ReactDOM.findDOMNode(this.refs.pageSize).value;
		if (/^[0-9]+$/.test(pageSize)) {
			this.props.updatePageSize(pageSize);
		} else {
			ReactDOM.findDOMNode(this.refs.pageSize).value = pageSize.substring(0, pageSize.length - 1);
		}
	}

	handleNavFirst(e) {
		e.preventDefault();
		this.props.onNavigate(this.props.links.first.href);
	}

	handleNavPrev(e) {
		e.preventDefault();
		this.props.onNavigate(this.props.links.prev.href);
	}

	handleNavNext(e) {
		e.preventDefault();
		this.props.onNavigate(this.props.links.next.href);
	}

	handleNavLast(e) {
		e.preventDefault();
		this.props.onNavigate(this.props.links.last.href);
	}

	render() {
		const pageInfo = this.props.page.hasOwnProperty("number") ?
			<h3>Aggregators - Page {this.props.page.number + 1} of {this.props.page.totalPages}</h3> : null;

		const aggregators = this.props.aggregators.map(aggregator =>
			<Aggregator key={aggregator.entity._links.self.href}
					  aggregator={aggregator}
					  attributes={this.props.attributes}
					  onUpdate={this.props.onUpdate}
					  onDelete={this.props.onDelete}/>
		);

		const navLinks = [];
		if ("first" in this.props.links) {
			navLinks.push(<button key="first" onClick={this.handleNavFirst}>&lt;&lt;</button>);
		}
		if ("prev" in this.props.links) {
			navLinks.push(<button key="prev" onClick={this.handleNavPrev}>&lt;</button>);
		}
		if ("next" in this.props.links) {
			navLinks.push(<button key="next" onClick={this.handleNavNext}>&gt;</button>);
		}
		if ("last" in this.props.links) {
			navLinks.push(<button key="last" onClick={this.handleNavLast}>&gt;&gt;</button>);
		}

		return (
			<div>
				{pageInfo}
				<input ref="pageSize" defaultValue={this.props.pageSize} onInput={this.handleInput}/>
				<table>
					<tbody>
						<tr>
							<th>First Name</th>
							<th>Last Name</th>
							<th>Description</th>
							<th></th>
							<th></th>
						</tr>
						{aggregators}
					</tbody>
				</table>
				<div>
					{navLinks}
				</div>
			</div>
		)
	}
}

class Aggregator extends React.Component {

	constructor(props) {
		super(props);
		this.handleDelete = this.handleDelete.bind(this);
	}

	handleDelete() {
		this.props.onDelete(this.props.aggregator);
	}

	render() {
		return (
			<tr>
				<td>{this.props.aggregator.entity.name}</td>
				<td>
					<UpdateDialog aggregator={this.props.aggregator}
								  attributes={this.props.attributes}
								  onUpdate={this.props.onUpdate}/>
				</td>
				<td>
					<button onClick={this.handleDelete}>Delete</button>
				</td>
			</tr>
		)
	}
}

ReactDOM.render(
	<App />,
	document.getElementById('react')
)