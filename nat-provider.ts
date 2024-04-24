import { CfnAutoScalingGroup } from "aws-cdk-lib/aws-autoscaling";
import { CfnEIP, CfnEIPAssociation, CfnLaunchTemplate, CfnNetworkInterface, ConfigureNatOptions, Connections, GatewayConfig, ISecurityGroup, KeyPair, KeyPairType, NatInstanceProps, NatProvider, Peer, Port, PrivateSubnet, RouterType, SecurityGroup, SpotRequestType } from "aws-cdk-lib/aws-ec2";
import { InstanceProfile, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export class Nat extends NatProvider {
    private readonly node: Construct;

    private networkInterface: CfnNetworkInterface;

    public securityGroup: ISecurityGroup;
    public connections: Connections;

    constructor(scope: Construct, private readonly props: NatInstanceProps) {
        super();
        
        this.node = new Construct(scope, 'Nat');
    }

    configureNat(options: ConfigureNatOptions) {
        this.securityGroup = new SecurityGroup(this.node, 'SecurityGroup', {
            vpc: options.vpc,
            allowAllIpv6Outbound: true
        });

        this.connections = new Connections({
            securityGroups: [
                this.securityGroup
            ]
        });

        this.connections.allowFromAnyIpv4(Port.allTraffic());

        this.connections.allowFrom(Peer.anyIpv6(), Port.allTraffic());

        const subnet = options.natSubnets[0];

        const profile = new InstanceProfile(this.node, 'InstanceProfile', {
            role: new Role(this.node, 'Role', {
                assumedBy: new ServicePrincipal('ec2.amazonaws.com')
            })
        });

        this.networkInterface = new CfnNetworkInterface(this.node, 'NetworkInterface', {
            sourceDestCheck: false,
            subnetId: subnet.subnetId,
            groupSet: [ this.securityGroup.securityGroupId ]
        });

        const ip = new CfnEIP(this.node, 'Ip');

        new CfnEIPAssociation(ip, 'Association', {
            networkInterfaceId: this.networkInterface.attrId,
            allocationId: ip.attrAllocationId
        });

        const keyPair = new KeyPair(this.node, 'Key', {
            type: KeyPairType.ED25519
        });

        const launchTemplate = new CfnLaunchTemplate(this.node, 'LaunchTemplate', {
            launchTemplateData: {
                instanceType: this.props.instanceType.toString(),
                imageId: this.props.machineImage?.getImage(this.node).imageId,
                keyName: keyPair.keyPairName,
                iamInstanceProfile: {
                    arn: profile.instanceProfileArn
                },
                metadataOptions: {
                    httpProtocolIpv6: 'enabled',
                    httpTokens: 'required'
                },
                instanceMarketOptions: {
                    marketType: 'spot',
                    spotOptions: {
                        spotInstanceType: SpotRequestType.ONE_TIME
                    }
                },
                networkInterfaces: [{
                    networkInterfaceId: this.networkInterface.attrId,
                    deviceIndex: 0
                }]
            }
        });

        new CfnAutoScalingGroup(this.node, 'AutoScalingGroup', {
            minSize: '1',
            maxSize: '1',
            launchTemplate: {
                launchTemplateId: launchTemplate.ref,
                version: launchTemplate.attrLatestVersionNumber
            },
            availabilityZones: [subnet.availabilityZone]
        });

        options.privateSubnets.forEach(subnet => this.configureSubnet(subnet));
    }

    get configuredGateways(): Array<GatewayConfig> {
        throw new Error("Not implemented");
    }

    public configureSubnet(subnet: PrivateSubnet) {
        subnet.addRoute('DefaultRoute', {
            routerId: this.networkInterface.ref,
            routerType: RouterType.NETWORK_INTERFACE,
            enablesInternetConnectivity: true
        });
    }
}
